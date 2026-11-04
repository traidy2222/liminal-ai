import readline from 'node:readline';
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.op === 'warmup') request.audio = '';
  if (request.audio === 'hang') continue;
  if (request.audio === 'crash') process.exit(4);
  if (request.audio === 'invalid') { console.log('invalid JSON'); continue; }
  console.log(JSON.stringify({ id: request.id, result: { text: request.audio, noSpeech: !request.audio, durationSec: 1 } }));
}
