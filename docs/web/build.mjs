import { readFileSync, writeFileSync } from 'node:fs';
const D = readFileSync(process.argv[2], 'utf8');
const html = readFileSync(process.argv[3], 'utf8').replace('/*__DATA__*/', D);
writeFileSync(process.argv[4], html);
console.log('wrote', process.argv[4], (html.length/1024).toFixed(0)+'K');
