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
