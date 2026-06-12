Pod::Spec.new do |s|
  s.name             = 'liminal_remote_desktop'
  s.version          = '0.1.0'
  s.summary          = 'Liminal remote desktop capture'
  s.homepage         = 'https://vireondynamics.com'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'Vireon Dynamics' => 'support@vireondynamics.com' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency 'FlutterMacOS'
  s.platform = :osx, '10.14'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.swift_version = '5.0'
end
