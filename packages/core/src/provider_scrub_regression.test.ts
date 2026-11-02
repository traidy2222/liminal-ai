import test from 'node:test';
import assert from 'node:assert/strict';
import { stripProviderSpecialTokens } from './provider_token_scrub.js';
test('nested removal cannot reconstruct a provider control token',()=>{
 const input='<|im_<|im_end|>end|>';
 assert.equal(stripProviderSpecialTokens(input),'');
});
