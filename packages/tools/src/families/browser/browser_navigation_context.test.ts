import test from 'node:test';import assert from 'node:assert/strict';
import {requestedBrowserDates,applyBrowserDateContext,isCurrentBrowserTabHandle,browserPageMatches}from './browser_navigation_context.js';

test('date constraints come from one explicit valid range, with no inferred year',()=>{
  const dates={start:'2027-03-17',end:'2027-03-21'};
  for(const text of ['Tokyo hotels 17–21 March 2027','Tokyo hotels March 17-21, 2027','2027-03-17 to 2027-03-21'])assert.deepEqual(requestedBrowserDates(text),dates);
  for(const text of ['17–21 March','29–31 February 2027','2027-02-29 to 2027-03-02','21–17 March 2027','17–21 March 2027 then 25–29 March 2027','17–21 March 2027, but flexible dates'])assert.equal(requestedBrowserDates(text),undefined);
});

test('page identity permits tracking fields while retaining explicit date checks',()=>{
  assert.ok(browserPageMatches('https://example.test/hotel','https://example.test/hotel?checkin=2027-03-17&tracking=x'));
  assert.ok(browserPageMatches('https://example.test/hotel?checkin=2027-03-17','https://example.test/hotel?checkin=2027-03-17&tracking=x'));
  assert.equal(browserPageMatches('https://example.test/hotel?checkin=2027-03-17','https://example.test/hotel?checkin=2027-03-18'),false);
  assert.equal(browserPageMatches('https://example.test/hotel?checkin=2027-03-17','https://example.test/hotel?checkin=2027-03-18&checkin=2027-03-17'),false);
  assert.equal(browserPageMatches('https://example.test/hotel','https://other.test/hotel'),false);
});

test('explicit dates repair wrong or missing URL fields, without changing other parameters',()=>{
  const dates={start:'2027-03-17',end:'2027-03-21'};
  const result=applyBrowserDateContext('https://example.test/search?checkin=2026-12-20&checkout=2026-12-24&currency=AUD&adults=2',dates);
  const url=new URL(result.url);assert.equal(url.searchParams.get('checkin'),dates.start);assert.equal(url.searchParams.get('checkout'),dates.end);
  assert.equal(url.searchParams.get('currency'),'AUD');assert.equal(url.searchParams.get('adults'),'2');assert.equal(result.changes.length,2);
  const missing=applyBrowserDateContext('https://example.test/room?checkin=2027-03-17',dates);assert.equal(new URL(missing.url).searchParams.get('checkout'),dates.end);
});

test('same-page refinements retain dates; new sites, signed links and flexible dates stay intact',()=>{
  const current='https://example.test/search?checkin=2027-03-17&checkout=2027-03-21';
  assert.equal(new URL(applyBrowserDateContext('https://example.test/search?sort=price',undefined,current).url).searchParams.get('checkout'),'2027-03-21');
  for(const target of ['https://other.test/search?sort=price','https://example.test/login','https://example.test/search?checkin=2027-04-01&checkout=2027-04-05'])assert.equal(applyBrowserDateContext(target,undefined,current).url,target);
  const signed='https://example.test/room?checkin=2026-12-20&sig=opaque';assert.equal(applyBrowserDateContext(signed,{start:'2027-03-17',end:'2027-03-21'}).url,signed);
  assert.ok(isCurrentBrowserTabHandle('current'));assert.ok(isCurrentBrowserTabHandle('main'));assert.equal(isCurrentBrowserTabHandle('invented-tab-123'),false);
});
