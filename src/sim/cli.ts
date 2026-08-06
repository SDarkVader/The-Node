import { sweepStability } from './sweep.js';

const points = sweepStability({
  nMillersRange: [2, 3, 4],
  nBakersRange: [2, 3, 4, 5],
  gammaRange: [0.5, 1.0, 1.5, 1.9, 1.99, 2.0, 2.01, 2.1, 2.5, 3.0],
});

console.log('nMillers\tnBakers\tgamma\tavgBakerSpread\tavgMillerSpread\tavgFlourPrice');
for (const p of points) {
  console.log(
    `${p.nMillers}\t${p.nBakers}\t${p.gamma}\t${p.avgBakerSpread.toFixed(4)}\t${p.avgMillerSpread.toFixed(4)}\t${p.avgFlourPrice.toFixed(4)}`,
  );
}
