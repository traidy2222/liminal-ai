import readline from 'node:readline';
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { id, text } = JSON.parse(line);
  if (text === 'hang') continue;
  if (text === 'crash') process.exit(2);
  if (text === 'invalid') { console.log('invalid json'); continue; }
  const bytes=Buffer.alloc(48);bytes.write('RIFF');bytes.writeUInt32LE(40,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);
  bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);
  bytes.writeUInt32LE(4,40);bytes.writeUInt32LE(process.pid,44);
  console.log(JSON.stringify({ id, audio: bytes.toString('base64') }));
}
