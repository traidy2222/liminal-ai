#ifndef RUNNER_APP_IDENTITY_H_
#define RUNNER_APP_IDENTITY_H_

#include <string>
#include <vector>

// Returns true only when a replacement host was successfully started. The
// caller must then exit before starting Flutter or any runtime workers.
bool RelaunchWithInheritedAppIdentity(std::vector<std::string>& arguments,
                                     const wchar_t* raw_arguments);

#endif  // RUNNER_APP_IDENTITY_H_
