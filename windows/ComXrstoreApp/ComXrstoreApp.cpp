// ComXrstoreApp.cpp : Defines the entry point for the application.
//

#include "pch.h"
#include "ComXrstoreApp.h"

#include "AutolinkedNativeModules.g.h"
#include <NativeModules.h>

#include <algorithm>
#include <thread>
#include <string>
#include <urlmon.h>
#include <shlwapi.h>
#include <shellapi.h>

#pragma comment(lib, "urlmon.lib")
#pragma comment(lib, "shlwapi.lib")

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

// Case-insensitive substring search used to spot the bundled prerequisite
// installer (e.g. Epic's UEPrereqSetup_x64.exe under Engine\Extras\Redist)
// among the extracted files.
static bool ContainsCI(const std::wstring& haystack, const std::wstring& needle) {
  auto it = std::search(haystack.begin(), haystack.end(), needle.begin(), needle.end(),
    [](wchar_t a, wchar_t b) { return towlower(a) == towlower(b); });
  return it != haystack.end();
}

static std::wstring FindPrereqInstaller(const std::wstring& dir) {
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW((dir + L"\\*").c_str(), &fd);
  if (h == INVALID_HANDLE_VALUE) return L"";
  std::wstring result;
  do {
    if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
    std::wstring path = dir + L"\\" + fd.cFileName;
    if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      result = FindPrereqInstaller(path);
    } else if (ContainsCI(fd.cFileName, L"prereq") && ContainsCI(fd.cFileName, L".exe")) {
      result = path;
    }
    if (!result.empty()) break;
  } while (FindNextFileW(h, &fd));
  FindClose(h);
  return result;
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

// Wraps a value in double quotes for a Win32 command line, escaping any embedded
// backslashes/quotes per the rules CommandLineToArgvW expects, so a token or email
// containing spaces still arrives at the launched process as a single argument.
static std::wstring QuoteArg(const std::wstring& value) {
  std::wstring result = L"\"";
  for (size_t i = 0; i < value.size();) {
    size_t backslashes = 0;
    while (i < value.size() && value[i] == L'\\') { backslashes++; i++; }
    if (i == value.size()) {
      result.append(backslashes * 2, L'\\');
      break;
    }
    if (value[i] == L'"') {
      result.append(backslashes * 2 + 1, L'\\');
      result += L'"';
    } else {
      result.append(backslashes, L'\\');
      result += value[i];
    }
    i++;
  }
  result += L'"';
  return result;
}

REACT_MODULE(InstallModule)
struct InstallModule {
  // Launches an already-installed exe, always forwarding the current user's
  // access token and email as -Token=/-Email= arguments so the launched app
  // can authenticate as that user.
  REACT_METHOD(launchApp)
  void launchApp(std::string exePath, std::string token, std::string email,
    winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    try {
      std::wstring wExePath(exePath.begin(), exePath.end());

      if (GetFileAttributesW(wExePath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        OutputDebugStringA(("[XRLaunch] Executable not found: " + exePath + "\n").c_str());
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"LAUNCH_ERROR", "Executable not found: " + exePath});
        return;
      }

      std::wstring wToken(token.begin(), token.end());
      std::wstring wEmail(email.begin(), email.end());
      std::wstring params = L"-Token=" + QuoteArg(wToken) + L" -Email=" + QuoteArg(wEmail);

      SHELLEXECUTEINFOW sei = {};
      sei.cbSize = sizeof(sei);
      sei.fMask = SEE_MASK_NOCLOSEPROCESS;
      sei.lpVerb = L"open";
      sei.lpFile = wExePath.c_str();
      sei.lpParameters = params.c_str();
      sei.nShow = SW_SHOW;

      if (!ShellExecuteExW(&sei)) {
        DWORD err = GetLastError();
        OutputDebugStringA(("[XRLaunch] ShellExecuteExW failed, err=" + std::to_string(err) + "\n").c_str());
        promise.Reject(winrt::Microsoft::ReactNative::ReactError{"LAUNCH_ERROR", "Failed to launch executable"});
        return;
      }
      if (sei.hProcess) CloseHandle(sei.hProcess);

      OutputDebugStringA(("[XRLaunch] Launched: " + exePath + "\n").c_str());
      promise.Resolve(true);
    } catch (...) {
      OutputDebugStringA("[XRLaunch] Exception in launchApp\n");
      promise.Reject(winrt::Microsoft::ReactNative::ReactError{"LAUNCH_ERROR", "Unknown error"});
    }
  }

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

        // Run bundled prerequisite installer (e.g. DirectX/VC++ redist) silently,
        // if one shipped in the zip, before launching the app. Without this the
        // app launches straight into a native "component required" prompt that
        // has no taskbar presence, so it looks like install did nothing.
        std::wstring prereqPath = FindPrereqInstaller(extractDir);
        if (!prereqPath.empty()) {
          std::string prereqPathA(prereqPath.begin(), prereqPath.end());
          OutputDebugStringA(("[XRInstall] Running prerequisite installer: " + prereqPathA + "\n").c_str());

          SHELLEXECUTEINFOW preSei = {};
          preSei.cbSize = sizeof(preSei);
          preSei.fMask = SEE_MASK_NOCLOSEPROCESS;
          preSei.lpVerb = L"open";
          preSei.lpFile = prereqPath.c_str();
          preSei.lpParameters = L"/quiet /norestart";
          preSei.nShow = SW_HIDE;

          if (ShellExecuteExW(&preSei) && preSei.hProcess) {
            WaitForSingleObject(preSei.hProcess, 180000);
            DWORD exitCode = 0;
            GetExitCodeProcess(preSei.hProcess, &exitCode);
            CloseHandle(preSei.hProcess);
            OutputDebugStringA(("[XRInstall] Prerequisite installer finished, exitCode=" + std::to_string(exitCode) + "\n").c_str());
          } else {
            OutputDebugStringA("[XRInstall] Prerequisite installer failed to launch\n");
          }
        }

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
        if (!ShellExecuteExW(&runSei)) {
          DWORD err = GetLastError();
          OutputDebugStringA(("[XRInstall] Failed to launch " + exePathA + ", err=" + std::to_string(err) + "\n").c_str());
          promise.Reject(winrt::Microsoft::ReactNative::ReactError{"INSTALL_ERROR", "Failed to launch installed app"});
          return;
        }
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
