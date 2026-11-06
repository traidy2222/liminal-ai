#include "app_identity.h"

#include <windows.h>
#include <appmodel.h>
#include <shobjidl.h>

#include <algorithm>

namespace {
constexpr wchar_t kPackageFamily[] = L"VireonDynamics.Liminal_zgy2yzmx28e3a";
constexpr wchar_t kApplicationId[] =
    L"VireonDynamics.Liminal_zgy2yzmx28e3a!Liminal";

bool ActivateRegisteredBuild(const wchar_t* raw_arguments) {
  UINT32 count = 0;
  UINT32 names_length = 0;
  if (::GetPackagesByPackageFamily(kPackageFamily, &count, nullptr, &names_length,
                                   nullptr) != ERROR_INSUFFICIENT_BUFFER ||
      count == 0) {
    return false;
  }
  std::vector<PWSTR> names(count);
  std::vector<wchar_t> names_buffer(names_length);
  if (::GetPackagesByPackageFamily(kPackageFamily, &count, names.data(),
                                   &names_length, names_buffer.data()) !=
      ERROR_SUCCESS) {
    return false;
  }
  std::vector<wchar_t> executable(32768);
  const DWORD length = ::GetModuleFileNameW(nullptr, executable.data(),
                                          static_cast<DWORD>(executable.size()));
  if (length == 0 || length >= executable.size()) return false;
  const std::wstring exe_path(executable.data(), length);
  const auto separator = exe_path.find_last_of(L"\\/");
  if (separator == std::wstring::npos) return false;
  const std::wstring directory = exe_path.substr(0, separator);
  bool registered_here = false;
  for (UINT32 i = 0; i < count; ++i) {
    UINT32 path_length = 0;
    if (::GetPackagePathByFullName(names[i], &path_length, nullptr) !=
        ERROR_INSUFFICIENT_BUFFER) continue;
    std::vector<wchar_t> package_path(path_length);
    if (::GetPackagePathByFullName(names[i], &path_length, package_path.data()) ==
            ERROR_SUCCESS &&
        ::_wcsicmp(directory.c_str(), package_path.data()) == 0) {
      registered_here = true;
      break;
    }
  }
  // Never redirect a different portable copy or a Flutter development run.
  if (!registered_here) return false;

  const HRESULT com = ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(com)) return false;
  IApplicationActivationManager* manager = nullptr;
  HRESULT result = ::CoCreateInstance(CLSID_ApplicationActivationManager, nullptr,
                                      CLSCTX_LOCAL_SERVER, IID_PPV_ARGS(&manager));
  if (SUCCEEDED(result)) {
    DWORD process_id = 0;
    result = manager->ActivateApplication(kApplicationId, raw_arguments,
                                         AO_NOERRORUI, &process_id);
    manager->Release();
  }
  ::CoUninitialize();
  return SUCCEEDED(result);
}
}  // namespace

bool RelaunchWithInheritedAppIdentity(std::vector<std::string>& arguments,
                                     const wchar_t* raw_arguments) {
  constexpr char kHostArgument[] = "--liminal-identity-host";
  const auto host_argument =
      std::find(arguments.begin(), arguments.end(), kHostArgument);
  if (host_argument != arguments.end()) {
    arguments.erase(host_argument);
    return false;
  }

  UINT32 app_id_length = 0;
  if (::GetCurrentApplicationUserModelId(&app_id_length, nullptr) !=
      ERROR_INSUFFICIENT_BUFFER) {
    // Direct .exe launches must activate the registered app to enter its
    // desktop-package context. Unregistered portable copies remain usable.
    return ActivateRegisteredBuild(raw_arguments);
  }

  // Windows defaults desktop-package descendants to break away from the app.
  // Start the UI host once with the documented inheritable desktop-app policy
  // so its Node, Python and browser descendants retain the same app identity.
  // This launcher exits immediately: it adds no resident helper process.
  SIZE_T attributes_size = 0;
  ::InitializeProcThreadAttributeList(nullptr, 1, 0, &attributes_size);
  std::vector<unsigned char> storage(attributes_size);
  auto attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  if (!::InitializeProcThreadAttributeList(attributes, 1, 0, &attributes_size)) {
    return false;
  }
  DWORD policy = PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_DISABLE_PROCESS_TREE |
                 PROCESS_CREATION_DESKTOP_APP_BREAKAWAY_OVERRIDE;
  if (!::UpdateProcThreadAttribute(attributes, 0,
                                  PROC_THREAD_ATTRIBUTE_DESKTOP_APP_POLICY,
                                  &policy, sizeof(policy), nullptr, nullptr)) {
    ::DeleteProcThreadAttributeList(attributes);
    ::OutputDebugStringW(L"Liminal: could not set inherited app identity.\n");
    return false;
  }

  std::vector<wchar_t> executable(32768);
  const DWORD length = ::GetModuleFileNameW(nullptr, executable.data(),
                                          static_cast<DWORD>(executable.size()));
  bool created = false;
  if (length > 0 && length < executable.size()) {
    std::wstring command = ::GetCommandLineW();
    command += L" --liminal-identity-host";
    STARTUPINFOEXW startup = {};
    startup.StartupInfo.cb = sizeof(startup);
    startup.lpAttributeList = attributes;
    PROCESS_INFORMATION process = {};
    created = ::CreateProcessW(executable.data(), command.data(), nullptr, nullptr,
                               FALSE, EXTENDED_STARTUPINFO_PRESENT, nullptr,
                               nullptr, &startup.StartupInfo, &process) != FALSE;
    if (created) {
      ::CloseHandle(process.hThread);
      ::CloseHandle(process.hProcess);
    } else {
      ::OutputDebugStringW(L"Liminal: could not start app identity host.\n");
    }
  }
  ::DeleteProcThreadAttributeList(attributes);
  return created;
}
