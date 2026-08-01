// ComXrstoreApp.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "ComXrstoreApp.h"

#include "AutolinkedNativeModules.g.h"
#include <NativeModules.h>

#include <thread>
#include <string>
#include <wininet.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <winrt/Windows.Data.Json.h>
#include <atomic>
#include <chrono>
#include <fstream>
#include <optional>
#include <vector>
#include <mutex>
#include <map>
#include <memory>
#include <cstdlib>

#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "shlwapi.lib")

// ─── Shared helpers ──────────────────────────────────────────────────────────

static std::string WToA(const std::wstring& w) {
  return std::string(w.begin(), w.end());
}
static std::wstring AToW(const std::string& a) {
  return std::wstring(a.begin(), a.end());
}

// Proper UTF-8 -> UTF-16 conversion for values that may contain non-ASCII
// characters (e.g. emails), where AToW's byte-truncating cast would corrupt
// them.
static std::wstring Utf8ToWide(const std::string& utf8) {
  if (utf8.empty()) return std::wstring();
  int size = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), (int)utf8.size(), nullptr, 0);
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), (int)utf8.size(), result.data(), size);
  return result;
}

// Quotes a single command-line argument value per the rules CommandLineToArgvW
// uses to parse it back (backslashes only need escaping immediately before a
// quote or at the very end of a quoted run). Values with no whitespace or
// quote characters are left bare. Used to build the -Token=/-Email= value
// forwarded to launched XR Store apps - see InstallModule::launchApp below
// and StartupArgsModule's ParseStartupArguments, which reads it back.
static std::wstring QuoteArg(const std::wstring& value) {
  if (!value.empty() && value.find_first_of(L" \t\n\v\"") == std::wstring::npos) {
    return value;
  }
  std::wstring result = L"\"";
  for (auto it = value.begin(); ; ++it) {
    size_t backslashes = 0;
    while (it != value.end() && *it == L'\\') {
      ++it;
      ++backslashes;
    }
    if (it == value.end()) {
      result.append(backslashes * 2, L'\\');
      break;
    } else if (*it == L'"') {
      result.append(backslashes * 2 + 1, L'\\');
      result.push_back(*it);
    } else {
      result.append(backslashes, L'\\');
      result.push_back(*it);
    }
  }
  result.push_back(L'"');
  return result;
}

static std::wstring GetLocalAppDataDir() {
  wchar_t* buf = nullptr;
  size_t len = 0;
  std::wstring result;
  if (_wdupenv_s(&buf, &len, L"LOCALAPPDATA") == 0 && buf) {
    result = buf;
    free(buf);
  }
  return result + L"\\ComXrstoreApp";
}

static std::wstring GetDefaultPackagesDir() {
  std::wstring base = GetLocalAppDataDir();
  std::wstring dir = base + L"\\Packages";
  CreateDirectoryW(base.c_str(), nullptr);
  CreateDirectoryW(dir.c_str(), nullptr);
  return dir;
}

static std::wstring GetInstalledDirForPackage(const std::wstring& packageId) {
  std::wstring base = GetLocalAppDataDir() + L"\\Installed";
  CreateDirectoryW(GetLocalAppDataDir().c_str(), nullptr);
  CreateDirectoryW(base.c_str(), nullptr);
  return base + L"\\" + packageId;
}

// Strips characters unsafe for a Windows directory/file name.
static std::wstring SanitizeId(const std::wstring& stem) {
  std::wstring out;
  for (wchar_t c : stem) {
    if (iswalnum(c) || c == L'-' || c == L'_' || c == L'.') out += c;
    else out += L'_';
  }
  return out.empty() ? L"_" : out;
}

// Peeks the first 4 bytes for the ZIP local-file-header signature PK\x03\x04
// (or PK\x05\x06 for an empty archive) without extracting anything.
static bool IsValidZipSignature(const std::wstring& path) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  unsigned char sig[4] = {};
  f.read(reinterpret_cast<char*>(sig), 4);
  if (f.gcount() < 4) return false;
  return sig[0] == 0x50 && sig[1] == 0x4B &&
         ((sig[2] == 0x03 && sig[3] == 0x04) || (sig[2] == 0x05 && sig[3] == 0x06));
}

// Parses "Name-1.2.3.zip" / "Name_v1.2.3" stems into {name, version}.
// No trailing version-looking token -> whole stem is the name, version is empty.
static void ParseFilenameMeta(const std::wstring& stem, std::wstring& outName, std::wstring& outVersion) {
  size_t splitPos = std::wstring::npos;
  size_t searchFrom = stem.size();
  while (true) {
    size_t i = stem.find_last_of(L"-_", searchFrom == 0 ? 0 : searchFrom - 1);
    if (i == std::wstring::npos || i == 0) break;
    std::wstring tail = stem.substr(i + 1);
    if (!tail.empty() && (tail[0] == L'v' || tail[0] == L'V')) tail = tail.substr(1);
    bool looksLikeVersion = !tail.empty();
    for (wchar_t c : tail) {
      if (!iswdigit(c) && c != L'.') { looksLikeVersion = false; break; }
    }
    if (looksLikeVersion) { splitPos = i; }
    break;
  }
  if (splitPos != std::wstring::npos) {
    outName = stem.substr(0, splitPos);
    std::wstring tail = stem.substr(splitPos + 1);
    if (!tail.empty() && (tail[0] == L'v' || tail[0] == L'V')) tail = tail.substr(1);
    outVersion = tail;
  } else {
    outName = stem;
    outVersion = L"";
  }
}

// ─── Download progress state ─────────────────────────────────────────────────

// Tracks progress for a single in-flight (or just-finished) download, keyed by
// the caller-supplied id (JS passes the app's fileName). Shared across the
// detached download threads and the getDownloadStatus/dedup checks in
// installApp, so it must only ever be touched under g_downloadsMutex.
struct DownloadState {
  std::string status = "idle"; // downloading | paused | extracting | launching | completed | error
  unsigned long long bytesReceived = 0;
  unsigned long long totalBytes = 0;
  double percent = 0;
  double speedBps = 0;
  std::string error;
  std::string downloadPath;
  std::string installPath;
};

// Signals the running download thread from pauseDownload/cancelDownload. Kept
// separate from DownloadState (rather than an atomic on the struct itself)
// because the thread that owns a given control instance exits entirely on
// pause - a fresh control is created if/when the download resumes.
struct DownloadControl {
  std::atomic<bool> pauseRequested{false};
  std::atomic<bool> cancelRequested{false};
};

static std::mutex g_downloadsMutex;
static std::map<std::string, DownloadState> g_downloads;
static std::map<std::string, std::shared_ptr<DownloadControl>> g_controls;

// Deterministic per-id temp paths so pause/resume (and a plain re-run of
// installApp) always agree on where the partial file lives.
static std::wstring GetDownloadZipPath(const std::string& id) {
  wchar_t tempPath[MAX_PATH];
  GetTempPathW(MAX_PATH, tempPath);
  return std::wstring(tempPath) + L"xrstore_" + SanitizeId(AToW(id)) + L".zip";
}
static std::wstring GetDownloadExtractDir(const std::string& id) {
  wchar_t tempPath[MAX_PATH];
  GetTempPathW(MAX_PATH, tempPath);
  return std::wstring(tempPath) + L"xrstore_" + SanitizeId(AToW(id)) + L"_extract";
}

static std::string BuildProgressJson(const std::string& id, const DownloadState& s) {
  using namespace winrt::Windows::Data::Json;
  JsonObject obj;
  obj.SetNamedValue(L"id", JsonValue::CreateStringValue(AToW(id)));
  obj.SetNamedValue(L"status", JsonValue::CreateStringValue(AToW(s.status)));
  obj.SetNamedValue(L"bytesReceived", JsonValue::CreateNumberValue(static_cast<double>(s.bytesReceived)));
  obj.SetNamedValue(L"totalBytes", JsonValue::CreateNumberValue(static_cast<double>(s.totalBytes)));
  obj.SetNamedValue(L"percent", JsonValue::CreateNumberValue(s.percent));
  obj.SetNamedValue(L"speedBps", JsonValue::CreateNumberValue(s.speedBps));
  if (!s.error.empty()) obj.SetNamedValue(L"error", JsonValue::CreateStringValue(AToW(s.error)));
  if (!s.downloadPath.empty()) obj.SetNamedValue(L"downloadPath", JsonValue::CreateStringValue(AToW(s.downloadPath)));
  if (!s.installPath.empty()) obj.SetNamedValue(L"installPath", JsonValue::CreateStringValue(AToW(s.installPath)));
  return WToA(std::wstring(obj.Stringify().c_str()));
}

// ─── InstallModule ───────────────────────────────────────────────────────────

static std::wstring FindExeRecursive(const std::wstring& dir) {
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW((dir + L"\\*.exe").c_str(), &fd);
  if (h != INVALID_HANDLE_VALUE) {
    std::wstring found = dir + L"\\" + fd.cFileName;
    FindClose(h);
    return found;
  }
  h = FindFirstFileW((dir + L"\\*").c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return L"";
  do {
    if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) &&
        wcscmp(fd.cFileName, L".") != 0 && wcscmp(fd.cFileName, L"..") != 0) {
      std::wstring found = FindExeRecursive(dir + L"\\" + fd.cFileName);
      if (!found.empty()) { FindClose(h); return found; }
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return L"";
}

// Returns false if anything under `dir` (including `dir` itself) could not be
// removed - e.g. a file left read-only by the extracted package, or an exe
// still locked because the app is running. Callers that only use this to
// clear space before a fresh install can ignore the result; uninstallApp
// surfaces it so the UI doesn't report success when files are still on disk.
static bool DeleteDirRecursive(const std::wstring& dir) {
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW((dir + L"\\*").c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return true;
  bool allDeleted = true;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    std::wstring path = dir + L"\\" + fd.cFileName;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (!DeleteDirRecursive(path)) allDeleted = false;
      if (!RemoveDirectoryW(path.c_str())) allDeleted = false;
    } else {
      if (fd.dwFileAttributes & FILE_ATTRIBUTE_READONLY) {
        SetFileAttributesW(path.c_str(), fd.dwFileAttributes & ~FILE_ATTRIBUTE_READONLY);
      }
      if (!DeleteFileW(path.c_str())) allDeleted = false;
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  if (!RemoveDirectoryW(dir.c_str())) allDeleted = false;
  return allDeleted;
}

REACT_MODULE(InstallModule)
struct InstallModule {
  // `id` is a caller-supplied unique key (JS passes the app's fileName) used to
  // track progress and to reject duplicate concurrent calls for the same app.
  // If a previous call for this id was paused (see pauseDownload below), this
  // call resumes it via an HTTP Range request instead of starting over.
  REACT_METHOD(installApp)
  void installApp(std::string id, std::string zipUrl, std::string fileName,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    unsigned long long resumeFromBytes = 0;
    unsigned long long resumeTotalBytes = 0;
    auto control = std::make_shared<DownloadControl>();
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      auto it = g_downloads.find(id);
      if (it != g_downloads.end()) {
        if (it->second.status == "downloading" || it->second.status == "extracting" || it->second.status == "launching") {
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"ALREADY_IN_PROGRESS", "Download already in progress for this id"});
          return;
        }
        if (it->second.status == "paused" && it->second.bytesReceived > 0) {
          resumeFromBytes = it->second.bytesReceived;
          resumeTotalBytes = it->second.totalBytes;
        }
      }
      DownloadState fresh;
      fresh.status = "downloading";
      if (resumeFromBytes > 0) {
        fresh.bytesReceived = resumeFromBytes;
        fresh.totalBytes = resumeTotalBytes;
        fresh.percent = resumeTotalBytes > 0 ? (100.0 * static_cast<double>(resumeFromBytes) / static_cast<double>(resumeTotalBytes)) : 0;
      }
      g_downloads[id] = fresh;
      g_controls[id] = control;
    }
    EmitProgress(id);

    std::thread([id, zipUrl, fileName, promise, resumeFromBytes, resumeTotalBytes, control, this]() mutable {
      try {
        OutputDebugStringA(("[XRInstall] installApp called: " + zipUrl + "\n").c_str());

        std::wstring zipFilePath = GetDownloadZipPath(id);
        std::wstring extractDir  = GetDownloadExtractDir(id);

        std::string zipFilePathA = WToA(zipFilePath);
        std::string extractDirA = WToA(extractDir);
        OutputDebugStringA(("[XRInstall] Download destination: " + zipFilePathA + "\n").c_str());
        OutputDebugStringA(("[XRInstall] Extract destination:  " + extractDirA + "\n").c_str());

        // Download ZIP via WinINet, chunked so we can report progress
        OutputDebugStringA("[XRInstall] Downloading ZIP...\n");
        std::wstring wZipUrl = AToW(zipUrl);

        HINTERNET hSession = InternetOpenW(L"xrstoreapp", INTERNET_OPEN_TYPE_PRECONFIG, nullptr, nullptr, 0);
        if (!hSession) {
          CleanupControl(id);
          EmitError(id, "Failed to initialize network session");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Failed to initialize network session"});
          return;
        }

        std::wstring rangeHeader;
        if (resumeFromBytes > 0) {
          rangeHeader = L"Range: bytes=" + std::to_wstring(resumeFromBytes) + L"-\r\n";
        }
        HINTERNET hUrl = InternetOpenUrlW(hSession, wZipUrl.c_str(),
          rangeHeader.empty() ? nullptr : rangeHeader.c_str(),
          rangeHeader.empty() ? 0 : static_cast<DWORD>(rangeHeader.size()),
          INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_NO_UI, 0);
        if (!hUrl) {
          InternetCloseHandle(hSession);
          CleanupControl(id);
          EmitError(id, "Download failed to start");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Download failed to start"});
          return;
        }

        // The server may not honor the Range request (common on plain static
        // hosts) - detect that and fall back to a full restart rather than
        // silently appending a duplicate full body onto the partial file.
        bool isResume = false;
        if (resumeFromBytes > 0) {
          DWORD statusCode = 0;
          DWORD statusSize = sizeof(statusCode);
          DWORD idx = 0;
          if (HttpQueryInfoW(hUrl, HTTP_QUERY_STATUS_CODE | HTTP_QUERY_FLAG_NUMBER, &statusCode, &statusSize, &idx)) {
            isResume = (statusCode == 206);
          }
        }

        unsigned long long totalBytes = isResume ? resumeTotalBytes : 0;
        if (!isResume) {
          wchar_t lenBuf[32] = {};
          DWORD lenBufSize = sizeof(lenBuf);
          DWORD headerIndex = 0;
          if (HttpQueryInfoW(hUrl, HTTP_QUERY_CONTENT_LENGTH, lenBuf, &lenBufSize, &headerIndex)) {
            totalBytes = _wtoi64(lenBuf);
          }
        }
        {
          std::lock_guard<std::mutex> lock(g_downloadsMutex);
          auto& st = g_downloads[id];
          st.totalBytes = totalBytes;
          if (!isResume) st.bytesReceived = 0;
        }

        std::ofstream outFile(zipFilePath, isResume ? (std::ios::binary | std::ios::app) : std::ios::binary);
        if (!outFile) {
          InternetCloseHandle(hUrl);
          InternetCloseHandle(hSession);
          CleanupControl(id);
          EmitError(id, "Failed to create download file");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Failed to create download file"});
          return;
        }

        const DWORD bufferSize = 65536;
        std::vector<char> buffer(bufferSize);
        unsigned long long bytesReceived = isResume ? resumeFromBytes : 0;
        auto lastEmit = std::chrono::steady_clock::now();
        unsigned long long lastEmitBytes = bytesReceived;
        bool downloadFailed = false;
        bool paused = false;
        bool cancelled = false;

        while (true) {
          if (control->cancelRequested) { cancelled = true; break; }
          if (control->pauseRequested) { paused = true; break; }

          DWORD bytesRead = 0;
          if (!InternetReadFile(hUrl, buffer.data(), bufferSize, &bytesRead)) {
            downloadFailed = true;
            break;
          }
          if (bytesRead == 0) break; // EOF
          outFile.write(buffer.data(), bytesRead);
          bytesReceived += bytesRead;

          auto now = std::chrono::steady_clock::now();
          double elapsedSec = std::chrono::duration<double>(now - lastEmit).count();
          if (elapsedSec >= 0.15) {
            double speed = elapsedSec > 0 ? (bytesReceived - lastEmitBytes) / elapsedSec : 0;
            {
              std::lock_guard<std::mutex> lock(g_downloadsMutex);
              auto& st = g_downloads[id];
              st.bytesReceived = bytesReceived;
              st.percent = totalBytes > 0 ? (100.0 * static_cast<double>(bytesReceived) / static_cast<double>(totalBytes)) : 0;
              st.speedBps = speed;
            }
            EmitProgress(id);
            lastEmit = now;
            lastEmitBytes = bytesReceived;
          }
        }
        outFile.close();
        InternetCloseHandle(hUrl);
        InternetCloseHandle(hSession);

        if (cancelled) {
          DeleteFileW(zipFilePath.c_str());
          OutputDebugStringA("[XRInstall] Download cancelled\n");
          CleanupControl(id);
          EmitReset(id);
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"CANCELLED", "Download cancelled"});
          return;
        }
        if (paused) {
          OutputDebugStringA("[XRInstall] Download paused\n");
          {
            std::lock_guard<std::mutex> lock(g_downloadsMutex);
            auto& st = g_downloads[id];
            st.status = "paused";
            st.bytesReceived = bytesReceived;
            st.speedBps = 0;
          }
          EmitProgress(id);
          CleanupControl(id);
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"PAUSED", "Download paused"});
          return;
        }
        if (downloadFailed) {
          DeleteFileW(zipFilePath.c_str());
          OutputDebugStringA("[XRInstall] Download failed\n");
          CleanupControl(id);
          EmitError(id, "Download failed");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Download failed"});
          return;
        }
        OutputDebugStringA(("[XRInstall] Download complete -> " + zipFilePathA + "\n").c_str());

        {
          std::lock_guard<std::mutex> lock(g_downloadsMutex);
          auto& st = g_downloads[id];
          st.bytesReceived = bytesReceived;
          st.totalBytes = totalBytes > 0 ? totalBytes : bytesReceived;
          st.percent = 100.0;
          st.speedBps = 0;
          st.downloadPath = zipFilePathA;
        }
        EmitProgress(id);

        // Extract via PowerShell
        EmitStatus(id, "extracting");
        DeleteDirRecursive(extractDir);
        CreateDirectoryW(extractDir.c_str(), nullptr);
        OutputDebugStringA("[XRInstall] Extracting ZIP...\n");

        std::wstring psArgs = L"-NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath '"
          + zipFilePath + L"' -DestinationPath '" + extractDir + L"' -Force\"";

        SHELLEXECUTEINFOW sei = {};
        sei.cbSize = sizeof(sei);
        sei.fMask  = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE;
        sei.lpVerb = L"open";
        sei.lpFile = L"powershell.exe";
        sei.lpParameters = psArgs.c_str();
        sei.nShow  = SW_HIDE;

        if (!ShellExecuteExW(&sei) || !sei.hProcess) {
          OutputDebugStringA("[XRInstall] PowerShell launch failed\n");
          CleanupControl(id);
          EmitError(id, "Extraction failed");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Extraction failed"});
          return;
        }
        WaitForSingleObject(sei.hProcess, 300000);
        CloseHandle(sei.hProcess);
        DeleteFileW(zipFilePath.c_str());
        OutputDebugStringA(("[XRInstall] Extraction complete -> " + extractDirA + "\n").c_str());

        // Find EXE
        std::wstring exePath = FindExeRecursive(extractDir);
        if (exePath.empty()) {
          OutputDebugStringA("[XRInstall] EXE not found in ZIP\n");
          CleanupControl(id);
          EmitError(id, "EXE not found in ZIP");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "EXE not found in ZIP"});
          return;
        }
        std::string exePathA = WToA(exePath);
        OutputDebugStringA(("[XRInstall] Launching: " + exePathA + "\n").c_str());

        EmitStatus(id, "launching");

        SHELLEXECUTEINFOW runSei = {};
        runSei.cbSize = sizeof(runSei);
        runSei.fMask  = SEE_MASK_NOCLOSEPROCESS;
        runSei.lpVerb = L"open";
        runSei.lpFile = exePath.c_str();
        runSei.nShow  = SW_SHOW;
        ShellExecuteExW(&runSei);
        if (runSei.hProcess) CloseHandle(runSei.hProcess);

        OutputDebugStringA(("[XRInstall] Installer launched: " + exePathA + "\n").c_str());
        OutputDebugStringA("[XRInstall] Install flow complete\n");

        {
          std::lock_guard<std::mutex> lock(g_downloadsMutex);
          auto& st = g_downloads[id];
          st.status = "completed";
          st.installPath = exePathA;
        }
        CleanupControl(id);
        EmitProgress(id);

        // Return paths so JS can log them
        std::string result = "downloadPath=" + zipFilePathA + ";installPath=" + exePathA;
        promise.Resolve(result);
      } catch (...) {
        OutputDebugStringA("[XRInstall] Exception in installApp\n");
        CleanupControl(id);
        EmitError(id, "Unknown error");
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Unknown error"});
      }
    }).detach();
  }

  REACT_METHOD(pauseDownload)
  void pauseDownload(std::string id,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    std::shared_ptr<DownloadControl> control;
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      auto it = g_controls.find(id);
      if (it != g_controls.end()) control = it->second;
    }
    // If there's no live control, the download already finished/paused/failed
    // on its own - nothing to do, and that's not an error from the caller's
    // point of view.
    if (control) control->pauseRequested = true;
    promise.Resolve();
  }

  REACT_METHOD(cancelDownload)
  void cancelDownload(std::string id,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    std::shared_ptr<DownloadControl> control;
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      auto it = g_controls.find(id);
      if (it != g_controls.end()) control = it->second;
    }
    if (control) {
      // The running thread notices this and does the actual file cleanup +
      // reset once it unwinds, from EmitReset/CleanupControl below.
      control->cancelRequested = true;
      promise.Resolve();
      return;
    }
    // No live thread (e.g. already paused) - reset synchronously here instead.
    DeleteFileW(GetDownloadZipPath(id).c_str());
    EmitReset(id);
    promise.Resolve();
  }

  REACT_METHOD(getDownloadStatus)
  void getDownloadStatus(std::string id,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::lock_guard<std::mutex> lock(g_downloadsMutex);
    auto it = g_downloads.find(id);
    if (it == g_downloads.end()) {
      promise.Resolve("");
      return;
    }
    promise.Resolve(BuildProgressJson(id, it->second));
  }

  REACT_METHOD(addListener)
  void addListener(std::string /*eventName*/) noexcept {}

  REACT_METHOD(removeListeners)
  void removeListeners(double /*count*/) noexcept {}

  REACT_EVENT(onDownloadProgress);
  std::function<void(std::string const&)> onDownloadProgress;

  // Shares the same progress-event/dedup infrastructure as installApp, keyed
  // by `packageId` this time. There's no network download here, so the state
  // machine skips straight to "extracting" - and since the file is already
  // fully present on disk, bytesReceived/totalBytes are reported as the file's
  // full size up front so the shared progress UI reads sensibly.
  REACT_METHOD(installLocalPackage)
  void installLocalPackage(std::string filePath, std::string packageId,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      auto it = g_downloads.find(packageId);
      if (it != g_downloads.end() &&
          (it->second.status == "downloading" || it->second.status == "extracting" || it->second.status == "launching")) {
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"ALREADY_IN_PROGRESS", "Install already in progress for this package"});
        return;
      }
      g_downloads[packageId] = DownloadState{};
      g_downloads[packageId].status = "extracting";
    }
    EmitProgress(packageId);

    std::thread([filePath, packageId, promise, this]() mutable {
      try {
        std::wstring wFilePath = AToW(filePath);
        std::wstring wPackageId = SanitizeId(AToW(packageId));
        OutputDebugStringA(("[XRInstall] installLocalPackage: " + filePath + "\n").c_str());

        if (!IsValidZipSignature(wFilePath)) {
          OutputDebugStringA("[XRInstall] installLocalPackage: invalid zip signature\n");
          EmitError(packageId, "Invalid or corrupted zip");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Invalid or corrupted zip"});
          return;
        }

        WIN32_FILE_ATTRIBUTE_DATA fileInfo = {};
        if (GetFileAttributesExW(wFilePath.c_str(), GetFileExInfoStandard, &fileInfo)) {
          unsigned long long fileSize = (static_cast<unsigned long long>(fileInfo.nFileSizeHigh) << 32) | fileInfo.nFileSizeLow;
          std::lock_guard<std::mutex> lock(g_downloadsMutex);
          auto& st = g_downloads[packageId];
          st.bytesReceived = fileSize;
          st.totalBytes = fileSize;
          st.percent = 100.0;
        }
        EmitProgress(packageId);

        std::wstring installDir = GetInstalledDirForPackage(wPackageId);
        DeleteDirRecursive(installDir);
        CreateDirectoryW(installDir.c_str(), nullptr);

        std::wstring psArgs = L"-NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath '"
          + wFilePath + L"' -DestinationPath '" + installDir + L"' -Force\"";

        SHELLEXECUTEINFOW sei = {};
        sei.cbSize = sizeof(sei);
        sei.fMask  = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE;
        sei.lpVerb = L"open";
        sei.lpFile = L"powershell.exe";
        sei.lpParameters = psArgs.c_str();
        sei.nShow  = SW_HIDE;
        if (!ShellExecuteExW(&sei) || !sei.hProcess) {
          OutputDebugStringA("[XRInstall] installLocalPackage: PowerShell launch failed\n");
          EmitError(packageId, "Extraction failed");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Extraction failed"});
          return;
        }
        WaitForSingleObject(sei.hProcess, 300000);
        CloseHandle(sei.hProcess);

        std::wstring exePath = FindExeRecursive(installDir);
        if (exePath.empty()) {
          OutputDebugStringA("[XRInstall] installLocalPackage: EXE not found\n");
          EmitError(packageId, "EXE not found in package");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "EXE not found in package"});
          return;
        }
        std::string exePathA = WToA(exePath);
        OutputDebugStringA(("[XRInstall] installLocalPackage complete -> " + exePathA + "\n").c_str());

        {
          std::lock_guard<std::mutex> lock(g_downloadsMutex);
          auto& st = g_downloads[packageId];
          st.status = "completed";
          st.installPath = exePathA;
        }
        EmitProgress(packageId);

        promise.Resolve(exePathA);
      } catch (...) {
        OutputDebugStringA("[XRInstall] Exception in installLocalPackage\n");
        EmitError(packageId, "Unknown error");
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Unknown error"});
      }
    }).detach();
  }

  // token/email are the current xrstoreapp session's credentials (see
  // AppUsageService.launchApp on the JS side); when present they're forwarded
  // as -Token=/-Email= so the launched app can auto-login instead of showing
  // its own login screen (see StartupArgsModule::getStartupArguments, and
  // this app's own App.tsx which does the same thing on its own startup).
  REACT_METHOD(launchApp)
  void launchApp(std::string exePath, std::string token, std::string email,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    try {
      std::wstring wExePath = AToW(exePath);

      std::wstring parameters;
      if (!token.empty()) {
        parameters += L"-Token=" + QuoteArg(Utf8ToWide(token));
      }
      if (!email.empty()) {
        if (!parameters.empty()) parameters += L" ";
        parameters += L"-Email=" + QuoteArg(Utf8ToWide(email));
      }

      SHELLEXECUTEINFOW sei = {};
      sei.cbSize = sizeof(sei);
      sei.fMask  = SEE_MASK_NOCLOSEPROCESS;
      sei.lpVerb = L"open";
      sei.lpFile = wExePath.c_str();
      sei.lpParameters = parameters.empty() ? nullptr : parameters.c_str();
      sei.nShow  = SW_SHOW;
      if (!ShellExecuteExW(&sei)) {
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"LAUNCH_ERROR", "Failed to launch"});
        return;
      }
      if (sei.hProcess) CloseHandle(sei.hProcess);
      promise.Resolve();
    } catch (...) {
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"LAUNCH_ERROR", "Unknown error"});
    }
  }

  REACT_METHOD(uninstallApp)
  void uninstallApp(std::string path,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    try {
      std::wstring wPath = AToW(path);
      // `path` may be a packageId (local flow) or a filename/exe path (remote flow).
      // Prefer the deterministic per-package install dir; fall back to treating
      // `path` itself as a directory or the parent of a file path.
      std::wstring dirToDelete = GetInstalledDirForPackage(SanitizeId(wPath));
      if (GetFileAttributesW(dirToDelete.c_str()) == INVALID_FILE_ATTRIBUTES) {
        if (GetFileAttributesW(wPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
          dirToDelete = wPath;
        } else {
          size_t pos = wPath.find_last_of(L"\\/");
          dirToDelete = (pos != std::wstring::npos) ? wPath.substr(0, pos) : wPath;
        }
      }
      if (!DeleteDirRecursive(dirToDelete)) {
        OutputDebugStringA("[XRInstall] uninstallApp: some files could not be removed (in use or read-only)\n");
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{
          "UNINSTALL_ERROR", "Could not fully remove the app. Make sure it isn't still running, then try again."});
        return;
      }
      promise.Resolve();
    } catch (...) {
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"UNINSTALL_ERROR", "Unknown error"});
    }
  }

  REACT_METHOD(checkLocalInstall)
  void checkLocalInstall(std::string packageId,
    winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    try {
      std::wstring installDir = GetInstalledDirForPackage(SanitizeId(AToW(packageId)));
      std::wstring exePath = FindExeRecursive(installDir);
      if (exePath.empty()) {
        promise.Resolve(std::nullopt);
      } else {
        promise.Resolve(WToA(exePath));
      }
    } catch (...) {
      promise.Resolve(std::nullopt);
    }
  }

  REACT_METHOD(getInstallFolder)
  void getInstallFolder(std::string packageId,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    try {
      std::wstring installDir = GetInstalledDirForPackage(SanitizeId(AToW(packageId)));
      promise.Resolve(WToA(installDir));
    } catch (...) {
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Failed to resolve install folder"});
    }
  }

  REACT_METHOD(openFolder)
  void openFolder(std::string path,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    try {
      std::wstring wPath = AToW(path);
      DWORD attrs = GetFileAttributesW(wPath.c_str());
      if (attrs == INVALID_FILE_ATTRIBUTES || !(attrs & FILE_ATTRIBUTE_DIRECTORY)) {
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"OPEN_ERROR", "Folder does not exist"});
        return;
      }
      SHELLEXECUTEINFOW sei = {};
      sei.cbSize = sizeof(sei);
      sei.fMask  = SEE_MASK_NOCLOSEPROCESS;
      sei.lpVerb = L"open";
      sei.lpFile = wPath.c_str();
      sei.nShow  = SW_SHOWNORMAL;
      if (!ShellExecuteExW(&sei)) {
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"OPEN_ERROR", "Failed to open folder"});
        return;
      }
      if (sei.hProcess) CloseHandle(sei.hProcess);
      promise.Resolve();
    } catch (...) {
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"OPEN_ERROR", "Unknown error"});
    }
  }

 private:
  void EmitProgress(const std::string& id) {
    std::string json;
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      auto it = g_downloads.find(id);
      if (it == g_downloads.end()) return;
      json = BuildProgressJson(id, it->second);
    }
    if (onDownloadProgress) onDownloadProgress(json);
  }

  void EmitStatus(const std::string& id, const std::string& status) {
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      g_downloads[id].status = status;
    }
    EmitProgress(id);
  }

  void EmitError(const std::string& id, const std::string& message) {
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      auto& st = g_downloads[id];
      st.status = "error";
      st.error = message;
    }
    EmitProgress(id);
  }

  // Used after a cancel: replaces the entry with a fresh "idle" state (rather
  // than erasing it) so EmitProgress still finds something to emit - JS then
  // sees status "idle" and shows the plain Install button again.
  void EmitReset(const std::string& id) {
    {
      std::lock_guard<std::mutex> lock(g_downloadsMutex);
      g_downloads[id] = DownloadState{};
    }
    EmitProgress(id);
  }

  void CleanupControl(const std::string& id) {
    std::lock_guard<std::mutex> lock(g_downloadsMutex);
    g_controls.erase(id);
  }
};

// ─────────────────────────────────────────────────────────────────────────────

// ─── PackageWatcherModule ────────────────────────────────────────────────────

struct LocalPackageInfo {
  std::wstring id, name, version, filePath, error;
  unsigned long long sizeBytes = 0;
  long long mtime = 0; // FILETIME as int64 (100ns ticks since 1601)
  bool isValid = true;
};

static std::vector<LocalPackageInfo> ScanPackagesDir(const std::wstring& dir) {
  std::vector<LocalPackageInfo> results;
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW((dir + L"\\*.zip").c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return results;
  do {
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
    std::wstring fileName = fd.cFileName;
    if (fileName.size() <= 4) continue;
    std::wstring stem = fileName.substr(0, fileName.size() - 4); // strip ".zip"
    std::wstring fullPath = dir + L"\\" + fileName;

    // Sharing-violation guard: file may still be mid-copy. Skip for this cycle;
    // it'll be picked up correctly once the debounced rescan runs again.
    HANDLE testHandle = CreateFileW(fullPath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
      OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (testHandle == INVALID_HANDLE_VALUE) continue;
    CloseHandle(testHandle);

    LocalPackageInfo info;
    info.id = SanitizeId(stem);
    info.filePath = fullPath;
    ParseFilenameMeta(stem, info.name, info.version);
    info.sizeBytes = (static_cast<unsigned long long>(fd.nFileSizeHigh) << 32) | fd.nFileSizeLow;
    info.mtime = (static_cast<long long>(fd.ftLastWriteTime.dwHighDateTime) << 32) | fd.ftLastWriteTime.dwLowDateTime;
    info.isValid = IsValidZipSignature(fullPath);
    if (!info.isValid) info.error = L"Invalid or corrupted zip file";
    results.push_back(info);
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return results;
}

static std::string BuildPackagesJson(const std::vector<LocalPackageInfo>& pkgs) {
  using namespace winrt::Windows::Data::Json;
  JsonArray arr;
  for (auto& p : pkgs) {
    JsonObject obj;
    obj.SetNamedValue(L"id", JsonValue::CreateStringValue(p.id));
    obj.SetNamedValue(L"name", JsonValue::CreateStringValue(p.name));
    obj.SetNamedValue(L"version", JsonValue::CreateStringValue(p.version));
    obj.SetNamedValue(L"filePath", JsonValue::CreateStringValue(p.filePath));
    obj.SetNamedValue(L"sizeBytes", JsonValue::CreateNumberValue(static_cast<double>(p.sizeBytes)));
    obj.SetNamedValue(L"mtime", JsonValue::CreateNumberValue(static_cast<double>(p.mtime)));
    obj.SetNamedValue(L"isValid", JsonValue::CreateBooleanValue(p.isValid));
    if (!p.error.empty()) obj.SetNamedValue(L"error", JsonValue::CreateStringValue(p.error));
    arr.Append(obj);
  }
  return WToA(std::wstring(arr.Stringify().c_str()));
}

REACT_MODULE(PackageWatcherModule)
struct PackageWatcherModule {
  REACT_METHOD(startWatching)
  void startWatching(std::string folderPath,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    StopWatchingInternal(); // idempotent: restart cleanly if already running

    std::wstring dir = folderPath.empty() ? GetDefaultPackagesDir() : AToW(folderPath);
    if (!folderPath.empty() && GetFileAttributesW(dir.c_str()) == INVALID_FILE_ATTRIBUTES) {
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"WATCH_ERROR", "Folder does not exist"});
      return;
    }

    m_watchDir = dir;
    m_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    m_running = true;
    m_thread = std::thread([this]() { WatchLoop(); });

    EmitScan(); // synchronous first scan so JS has state before the promise resolves
    promise.Resolve(WToA(m_watchDir));
  }

  REACT_METHOD(stopWatching)
  void stopWatching(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    StopWatchingInternal();
    promise.Resolve();
  }

  REACT_METHOD(scanNow)
  void scanNow(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::wstring dir = m_watchDir.empty() ? GetDefaultPackagesDir() : m_watchDir;
    promise.Resolve(BuildPackagesJson(ScanPackagesDir(dir)));
  }

  REACT_METHOD(addListener)
  void addListener(std::string /*eventName*/) noexcept {}

  REACT_METHOD(removeListeners)
  void removeListeners(double /*count*/) noexcept {}

  REACT_EVENT(onPackagesChanged);
  std::function<void(std::string const&)> onPackagesChanged;

  REACT_EVENT(onScanError);
  std::function<void(std::string const&)> onScanError;

  ~PackageWatcherModule() { StopWatchingInternal(); }

 private:
  void StopWatchingInternal() {
    if (!m_running) return;
    m_running = false;
    if (m_stopEvent) SetEvent(m_stopEvent);
    if (m_thread.joinable()) m_thread.join();
    if (m_stopEvent) { CloseHandle(m_stopEvent); m_stopEvent = nullptr; }
  }

  void EmitScan() {
    try {
      auto pkgs = ScanPackagesDir(m_watchDir);
      if (onPackagesChanged) onPackagesChanged(BuildPackagesJson(pkgs));
    } catch (...) {
      if (onScanError) onScanError("Scan failed");
    }
  }

  void WatchLoop() {
    HANDLE hDir = CreateFileW(m_watchDir.c_str(), FILE_LIST_DIRECTORY,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, nullptr);
    if (hDir == INVALID_HANDLE_VALUE) {
      if (onScanError) onScanError("Failed to open folder for watching");
      return;
    }

    BYTE buffer[4096];
    OVERLAPPED ov = {};
    ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    HANDLE waitHandles[2] = { ov.hEvent, m_stopEvent };

    while (m_running) {
      DWORD bytesReturned = 0;
      BOOL ok = ReadDirectoryChangesW(hDir, buffer, sizeof(buffer), FALSE,
        FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE,
        &bytesReturned, &ov, nullptr);
      if (!ok && GetLastError() != ERROR_IO_PENDING) {
        if (onScanError) onScanError("Watcher read failed");
        break;
      }

      DWORD waitResult = WaitForMultipleObjects(2, waitHandles, FALSE, INFINITE);
      if (waitResult == WAIT_OBJECT_0 + 1 || !m_running) break; // stop signaled
      {
        DWORD dummy = 0;
        GetOverlappedResult(hDir, &ov, &dummy, FALSE);
      }
      ResetEvent(ov.hEvent);

      // Debounce: coalesce rapid-fire events within a quiet window before rescanning,
      // re-arming the watch on every interim event so nothing is missed.
      const DWORD debounceMs = 500;
      bool stopped = false;
      for (;;) {
        DWORD r = WaitForMultipleObjects(2, waitHandles, FALSE, debounceMs);
        if (r == WAIT_OBJECT_0 + 1 || !m_running) { stopped = true; break; }
        if (r == WAIT_TIMEOUT) break; // quiet window elapsed, proceed to scan

        DWORD dummy = 0;
        GetOverlappedResult(hDir, &ov, &dummy, FALSE);
        ResetEvent(ov.hEvent);
        ReadDirectoryChangesW(hDir, buffer, sizeof(buffer), FALSE,
          FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE,
          &dummy, &ov, nullptr);
      }
      if (stopped) break;
      EmitScan();
    }

    CancelIoEx(hDir, &ov);
    CloseHandle(hDir);
    CloseHandle(ov.hEvent);
  }

  std::wstring m_watchDir;
  std::thread m_thread;
  HANDLE m_stopEvent = nullptr;
  std::atomic<bool> m_running{false};
};

// ─── StartupArgsModule ───────────────────────────────────────────────────────
//
// Exposes the -Token=/-Email= command-line arguments this app may have been
// launched with (see QuoteArg + InstallModule::launchApp above, and its JS
// counterpart AppUsageService.launchApp) so the JS side can auto-login
// instead of showing the manual login screen. See App.tsx for the JS flow.

// Converts a UTF-16 Windows string to UTF-8. Written explicitly (rather than
// the byte-truncating std::string(begin, end) cast used elsewhere in this
// file) because emails can contain non-ASCII characters that must survive
// the trip to JS intact.
static std::string WideToUtf8(const std::wstring& wide) {
  if (wide.empty()) return std::string();
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), (int)wide.size(), nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), (int)wide.size(), result.data(), size, nullptr, nullptr);
  return result;
}

// Strips one layer of matching double quotes, e.g. from -Email="a@b.com".
// CommandLineToArgvW already un-quotes whole arguments, but a value quoted
// only on the right-hand side of -Token=/-Email= (as QuoteArg above produces)
// stays part of the same argv entry, so this handles that inner layer.
static std::wstring StripQuotes(std::wstring value) {
  if (value.size() >= 2 && value.front() == L'"' && value.back() == L'"') {
    return value.substr(1, value.size() - 2);
  }
  return value;
}

struct StartupArgumentsRaw {
  std::wstring token;
  std::wstring email;
};

// Parses -Token=/-Email= out of the process command line. Reads
// GetCommandLineW() directly instead of caching WinMain's argument, since the
// command line stays valid for the lifetime of the process and this only
// needs to run the first time JS asks for it. Missing or malformed arguments
// simply leave the corresponding field empty rather than failing.
static StartupArgumentsRaw ParseStartupArguments() noexcept {
  StartupArgumentsRaw result;
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argv == nullptr) return result;

  for (int i = 1; i < argc; i++) {
    std::wstring arg(argv[i]);
    auto matchArg = [&](const wchar_t* prefix, std::wstring& target) {
      size_t prefixLen = wcslen(prefix);
      if (arg.size() > prefixLen && _wcsnicmp(arg.c_str(), prefix, prefixLen) == 0) {
        target = StripQuotes(arg.substr(prefixLen));
      }
    };
    matchArg(L"-Token=", result.token);
    matchArg(L"-Email=", result.email);
  }

  LocalFree(argv);
  return result;
}

// REACT_STRUCT gives JS a plain { token, email } object without hand-rolling
// JSValue construction.
REACT_STRUCT(StartupArgumentsResult)
struct StartupArgumentsResult {
  REACT_FIELD(token)
  std::string token;

  REACT_FIELD(email)
  std::string email;
};

REACT_MODULE(StartupArgsModule)
struct StartupArgsModule {
  // Resolves with { token: "", email: "" } when the app was launched normally
  // (no -Token=/-Email=), so JS only needs to check `token` for truthiness -
  // it never needs to handle a rejected promise for the "no args" case.
  REACT_METHOD(getStartupArguments)
  void getStartupArguments(winrt::Microsoft::ReactNative::ReactPromise<StartupArgumentsResult> promise) noexcept {
    try {
      StartupArgumentsRaw args = ParseStartupArguments();
      StartupArgumentsResult result;
      result.token = WideToUtf8(args.token);
      result.email = WideToUtf8(args.email);
      // Deliberately not logging the token itself - only whether one was present.
      OutputDebugStringA(result.token.empty()
        ? "[StartupArgsModule] No startup token present\n"
        : "[StartupArgsModule] Startup token present\n");
      promise.Resolve(result);
    } catch (...) {
      OutputDebugStringA("[StartupArgsModule] Exception while parsing startup arguments\n");
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"STARTUP_ARGS_ERROR", "Failed to read startup arguments"});
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────

// A PackageProvider containing any turbo modules you define within this app project
struct CompReactPackageProvider
    : winrt::implements<CompReactPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
 public: // IReactPackageProvider
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
  }
};

// The entry point of the Win32 application
_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE instance, HINSTANCE, PSTR /* commandLine */, int showCmd) {
  winrt::init_apartment(winrt::apartment_type::single_threaded);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  auto reactNativeWin32App{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};
  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};
  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  settings.PackageProviders().Append(winrt::make<CompReactPackageProvider>());

#if BUNDLE
  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());
  settings.JavaScriptBundleFile(L"index.windows");
  settings.UseFastRefresh(false);
#else
  settings.JavaScriptBundleFile(L"index");
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  settings.UseDirectDebugger(true);
  settings.UseDeveloperSupport(true);
#else
  settings.UseDirectDebugger(false);
  settings.UseDeveloperSupport(false);
#endif

  auto appWindow{reactNativeWin32App.AppWindow()};
  appWindow.Title(L"xrstoreapp");
  appWindow.Resize({1000, 1000});

  auto viewOptions{reactNativeWin32App.ReactViewOptions()};
  viewOptions.ComponentName(L"xrstoreapp");

  reactNativeWin32App.Start();
}
