// ComXrstoreApp.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "ComXrstoreApp.h"

#include "AutolinkedNativeModules.g.h"
#include <NativeModules.h>

#include <thread>
#include <string>
#include <urlmon.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <winrt/Windows.Data.Json.h>
#include <atomic>
#include <chrono>
#include <fstream>
#include <optional>
#include <vector>

#pragma comment(lib, "urlmon.lib")
#pragma comment(lib, "shlwapi.lib")

// ─── Shared helpers ──────────────────────────────────────────────────────────

static std::string WToA(const std::wstring& w) {
  return std::string(w.begin(), w.end());
}
static std::wstring AToW(const std::string& a) {
  return std::wstring(a.begin(), a.end());
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

static void DeleteDirRecursive(const std::wstring& dir) {
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW((dir + L"\\*").c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    std::wstring path = dir + L"\\" + fd.cFileName;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      DeleteDirRecursive(path);
      RemoveDirectoryW(path.c_str());
    } else {
      DeleteFileW(path.c_str());
    }
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  RemoveDirectoryW(dir.c_str());
}

REACT_MODULE(InstallModule)
struct InstallModule {
  REACT_METHOD(installApp)
  void installApp(std::string zipUrl, std::string fileName,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::thread([=]() mutable {
      try {
        OutputDebugStringA(("[XRInstall] installApp called: " + zipUrl + "\n").c_str());

        wchar_t tempPath[MAX_PATH];
        GetTempPathW(MAX_PATH, tempPath);
        std::wstring wTempPath(tempPath);
        std::wstring zipFilePath = wTempPath + L"xrstore_download.zip";
        std::wstring extractDir  = wTempPath + L"xrstore_extract";

        std::string zipFilePathA(zipFilePath.begin(), zipFilePath.end());
        std::string extractDirA(extractDir.begin(), extractDir.end());
        OutputDebugStringA(("[XRInstall] Download destination: " + zipFilePathA + "\n").c_str());
        OutputDebugStringA(("[XRInstall] Extract destination:  " + extractDirA + "\n").c_str());

        // Download ZIP
        OutputDebugStringA("[XRInstall] Downloading ZIP...\n");
        std::wstring wZipUrl(zipUrl.begin(), zipUrl.end());
        HRESULT hr = URLDownloadToFileW(nullptr, wZipUrl.c_str(), zipFilePath.c_str(), 0, nullptr);
        if (FAILED(hr)) {
          OutputDebugStringA(("[XRInstall] Download failed hr=" + std::to_string(hr) + "\n").c_str());
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Download failed"});
          return;
        }
        OutputDebugStringA(("[XRInstall] Download complete -> " + zipFilePathA + "\n").c_str());

        // Extract via PowerShell
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
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "EXE not found in ZIP"});
          return;
        }
        std::string exePathA(exePath.begin(), exePath.end());
        OutputDebugStringA(("[XRInstall] Launching: " + exePathA + "\n").c_str());

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
        // Return paths so JS can log them
        std::string result = "downloadPath=" + zipFilePathA + ";installPath=" + exePathA;
        promise.Resolve(result);
      } catch (...) {
        OutputDebugStringA("[XRInstall] Exception in installApp\n");
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Unknown error"});
      }
    }).detach();
  }

  REACT_METHOD(installLocalPackage)
  void installLocalPackage(std::string filePath, std::string packageId,
    winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::thread([=]() mutable {
      try {
        std::wstring wFilePath = AToW(filePath);
        std::wstring wPackageId = SanitizeId(AToW(packageId));
        OutputDebugStringA(("[XRInstall] installLocalPackage: " + filePath + "\n").c_str());

        if (!IsValidZipSignature(wFilePath)) {
          OutputDebugStringA("[XRInstall] installLocalPackage: invalid zip signature\n");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Invalid or corrupted zip"});
          return;
        }

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
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Extraction failed"});
          return;
        }
        WaitForSingleObject(sei.hProcess, 300000);
        CloseHandle(sei.hProcess);

        std::wstring exePath = FindExeRecursive(installDir);
        if (exePath.empty()) {
          OutputDebugStringA("[XRInstall] installLocalPackage: EXE not found\n");
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "EXE not found in package"});
          return;
        }
        OutputDebugStringA(("[XRInstall] installLocalPackage complete -> " + WToA(exePath) + "\n").c_str());
        promise.Resolve(WToA(exePath));
      } catch (...) {
        OutputDebugStringA("[XRInstall] Exception in installLocalPackage\n");
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Unknown error"});
      }
    }).detach();
  }

  REACT_METHOD(launchApp)
  void launchApp(std::string exePath,
    winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    try {
      std::wstring wExePath = AToW(exePath);
      SHELLEXECUTEINFOW sei = {};
      sei.cbSize = sizeof(sei);
      sei.fMask  = SEE_MASK_NOCLOSEPROCESS;
      sei.lpVerb = L"open";
      sei.lpFile = wExePath.c_str();
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
      DeleteDirRecursive(dirToDelete);
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
