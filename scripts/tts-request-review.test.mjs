import test from 'node:test';
import {runDartReviewCase} from './lib/dart-review-case.mjs';
test('clip deadline closes the owned HTTP connection',{timeout:260000},()=>runDartReviewCase('review clip deadline closes the underlying socket'));
