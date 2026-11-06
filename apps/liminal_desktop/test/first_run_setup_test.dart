import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/app/app_scope.dart';
import 'package:liminal_desktop/state/app_controller.dart';
import 'package:liminal_desktop/state/chat_session_controller.dart';
import 'package:liminal_desktop/ui/screens/provider_setup_screen.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';

class SetupController extends AppController {
  Map<String,Object?>? saved;
  @override Future<List<Map<String,dynamic>>> discoverProviderModels({required String baseUrl,String apiKey=''})async=>[{'id':'local/test','name':'Loaded local model','toolCalling':null}];
  @override Future<bool> saveProvider({required String apiKey,String? model,String? baseUrl,bool requireApiKey=true})async{saved={'key':apiKey,'model':model,'requiresKey':requireApiKey};return false;}
}
void main(){
 testWidgets('local first run discovers a loaded model and continues without a cloud key',(tester)async{
  tester.view.physicalSize=const Size(1400,1400);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
  final controller=SetupController();addTearDown(controller.dispose);
  await tester.pumpWidget(AppScope(controller:controller,child:MaterialApp(theme:buildLiminalTheme(),home:const SetupScreen())));
  expect(find.text('API key'),findsOneWidget);
  await tester.tap(find.text('Local'));await tester.pump();expect(find.text('Server key (optional)'),findsOneWidget);
  await tester.ensureVisible(find.text('Load available models'));await tester.tap(find.text('Load available models'));await tester.pump();await tester.pump();
  expect(find.text('Loaded local model'),findsOneWidget);await tester.ensureVisible(find.text('Verify and continue'));await tester.tap(find.text('Verify and continue'));await tester.pump();
  expect(controller.saved,{'key':'','model':'local/test','requiresKey':false});expect(tester.takeException(),isNull);
 });
 test('persona cancellation releases the busy state and retains previews for retry',(){
  final session=ChatSessionController(chatId:'setup');
  session.applyServerEvent('persona_bootstrap_progress',{'stage':'generating','message':'Working','artifacts':[{'id':'runtime_profile','content':'draft'}]});expect(session.busy,isTrue);expect(session.personaBootstrapArtifacts.length,1);
  session.applyServerEvent('persona_bootstrap_progress',{'stage':'failed','message':'Cancelled'});expect(session.busy,isFalse);
  session.applyServerEvent('persona_bootstrap_progress',{'stage':'done','message':'Ready'});expect(session.busy,isFalse);session.dispose();
 });
}
