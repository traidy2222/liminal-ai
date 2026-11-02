import test from 'node:test';
import assert from 'node:assert/strict';
import { fileWriteSafeToDispatch } from './file_write_resume.js';
test('completed tool arguments are not rejected by quote-counting guesses',()=>{
 for(const content of ['He said "hello"', 'const quote = "\'";', 'A Markdown `code`']){
  const call={id:'call',name:'write_file',argsJson:JSON.stringify({path:'output.txt',content})};
  assert.equal(fileWriteSafeToDispatch(call,'tool_calls'),true,content);
  assert.equal(fileWriteSafeToDispatch(call,'stop'),true,content);
 }
 assert.equal(fileWriteSafeToDispatch({id:'call',name:'write_file',argsJson:'{"path":"x","content":"unfinished'},'length'),false);
});
