// api/analyze.js — Vercel Serverless Function
const path = require('path');
const fs   = require('fs');

// ── Carrega bancos de dados ──────────────────
const BD  = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/bd.json'),  'utf8'));
const BD2 = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/bd2.json'), 'utf8'));
const BD3 = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/bd3.json'), 'utf8'));

// ── Constantes ───────────────────────────────
const VALUES   = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS    = ['s','h','d','c'];
const CARD_VAL = BD3.card_values;

function buildDeck() {
  const deck = [];
  for (const s of SUITS) for (const v of VALUES) deck.push(v + s);
  return deck;
}

function removeCards(deck, cards) {
  return deck.filter(c => !cards.includes(c));
}

// ── Combinações ──────────────────────────────
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map(c => [first, ...c]),
    ...combinations(rest, k)
  ];
}

// ── Avaliador de mão (5 cartas) ──────────────
// Score = rank * 1_000_000 + tiebreaker → rank maior SEMPRE vence rank menor
function handScore(rank, tiebreakers) {
  let tb = 0;
  for (let i = 0; i < tiebreakers.length; i++) {
    tb += tiebreakers[i] * Math.pow(15, tiebreakers.length - 1 - i);
  }
  return rank * 1000000 + tb;
}

function evaluateHand5(cards) {
  const vals   = cards.map(c => CARD_VAL[c[0]]).sort((a, b) => b - a);
  const suits  = cards.map(c => c[1]);
  const isFlush = suits.every(s => s === suits[0]);
  const unique  = [...new Set(vals)].sort((a, b) => b - a);
  const counts  = {};
  vals.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const byGroup = Object.entries(counts)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);
  const groups  = byGroup.map(x => x.c);
  const kickers = byGroup.map(x => x.v);

  let isStraight = false, straightHigh = 0;
  if (unique.length >= 5) {
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) { isStraight = true; straightHigh = unique[i]; break; }
    }
  }
  if (!isStraight && unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
    isStraight = true; straightHigh = 5;
  }

  if (isFlush && isStraight && straightHigh === 14) return { rank: 9, name: 'royal_flush',    score: handScore(9, [straightHigh]) };
  if (isFlush && isStraight)                        return { rank: 8, name: 'straight_flush', score: handScore(8, [straightHigh]) };
  if (groups[0] === 4)                              return { rank: 7, name: 'four_of_a_kind', score: handScore(7, kickers) };
  if (groups[0] === 3 && groups[1] === 2)           return { rank: 6, name: 'full_house',     score: handScore(6, kickers) };
  if (isFlush)                                      return { rank: 5, name: 'flush',           score: handScore(5, vals) };
  if (isStraight)                                   return { rank: 4, name: 'straight',        score: handScore(4, [straightHigh]) };
  if (groups[0] === 3)                              return { rank: 3, name: 'three_of_a_kind',score: handScore(3, kickers) };
  if (groups[0] === 2 && groups[1] === 2)           return { rank: 2, name: 'two_pair',       score: handScore(2, kickers) };
  if (groups[0] === 2)                              return { rank: 1, name: 'one_pair',        score: handScore(1, kickers) };
  return                                                   { rank: 0, name: 'high_card',       score: handScore(0, vals) };
}

function bestHand(cards) {
  return combinations(cards, 5)
    .map(evaluateHand5)
    .reduce((best, h) => (!best || h.score > best.score ? h : best), null);
}

// ── Fisher-Yates shuffle ─────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Monte Carlo (corrigido) ──────────────────
function monteCarlo(holeCards, communityCards, numOpponents, iterations = 6000) {
  const known = [...holeCards, ...communityCards];
  const deck  = removeCards(buildDeck(), known);
  let wins = 0, ties = 0, total = 0;

  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffle(deck);
    const needed = 5 - communityCards.length;
    if (shuffled.length < needed + numOpponents * 2) continue;

    const board = [...communityCards, ...shuffled.slice(0, needed)];
    let idx = needed;

    const myScore = bestHand([...holeCards, ...board]).score;
    let bestOppScore = 0, valid = true;

    for (let p = 0; p < numOpponents; p++) {
      const opp = shuffled.slice(idx, idx + 2); idx += 2;
      if (opp.length < 2) { valid = false; break; }
      const s = bestHand([...opp, ...board]).score;
      if (s > bestOppScore) bestOppScore = s;
    }

    if (!valid) continue;
    total++;
    if (myScore > bestOppScore)       wins++;
    else if (myScore === bestOppScore) ties++;
  }

  if (total === 0) return 0;
  return (wins + ties * 0.5) / total;
}

// ── Detecção de draws ────────────────────────
function detectDraws(holeCards, communityCards) {
  const all    = [...holeCards, ...communityCards];
  const vals   = all.map(c => CARD_VAL[c[0]]);
  const suits  = all.map(c => c[1]);
  const draws  = [];

  const suitCounts = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s]||0)+1);
  if (Math.max(...Object.values(suitCounts)) === 4) draws.push({ ...BD2.draw_outs.flush_draw });

  const uv = [...new Set(vals)].sort((a,b) => a-b);
  for (let i = 0; i <= uv.length-4; i++) {
    if (uv[i+3]-uv[i] === 3) { draws.push({ ...BD2.draw_outs.open_ended_straight }); break; }
  }
  for (let i = 0; i <= uv.length-4; i++) {
    if (uv[i+3]-uv[i] === 4 && uv[i+1]-uv[i] > 1) { draws.push({ ...BD2.draw_outs.gutshot_straight }); break; }
  }
  return draws;
}

// ── Identifica mão pré-flop ──────────────────
function identifyStartingHand(holeCards) {
  const [c1, c2] = holeCards;
  const v1 = c1[0], v2 = c2[0], s1 = c1[1], s2 = c2[1];
  const suited = s1 === s2 ? 's' : 'o';
  const sorted = CARD_VAL[v1] >= CARD_VAL[v2] ? [v1,v2] : [v2,v1];
  if (v1 === v2) return BD.starting_hands[v1+v2] || { tier:'C', preflop_equity:0.55, description:`Par de ${v1}s` };
  return BD.starting_hands[sorted[0]+sorted[1]+suited] ||
         BD.starting_hands[sorted[0]+sorted[1]] ||
         { tier: suited==='s'?'C':'D', preflop_equity: suited==='s'?0.52:0.46, description:`${sorted[0]}${sorted[1]} ${suited==='s'?'suited':'offsuit'}` };
}

// ── Decisão ──────────────────────────────────
function getDecision(equity, currentHandRank) {
  // Mãos fortes nunca devem foldar por ruído de MC
  if (currentHandRank !== undefined) {
    if (currentHandRank >= 7) return { action: 'ALL_IN' }; // quadra ou melhor
    if (currentHandRank >= 5) return { action: 'RAISE'  }; // flush / full house
    if (currentHandRank >= 3) return equity >= 0.38 ? { action: 'RAISE' } : { action: 'CALL' };
  }
  const dm = BD3.decision_matrix.actions;
  if (equity < dm.FOLD.threshold_max)  return { action: 'FOLD'   };
  if (equity < dm.CHECK.threshold_max) return { action: 'CHECK'  };
  if (equity < dm.CALL.threshold_max)  return { action: 'CALL'   };
  if (equity < dm.RAISE.threshold_max) return { action: 'RAISE'  };
  return { action: 'ALL_IN' };
}

const HAND_LABELS = {
  royal_flush:'Royal Flush', straight_flush:'Straight Flush', four_of_a_kind:'Quadra',
  full_house:'Full House', flush:'Flush', straight:'Sequência',
  three_of_a_kind:'Trinca', two_pair:'Dois Pares', one_pair:'Um Par', high_card:'Carta Alta'
};

// ── Handler principal ────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { holeCards, communityCards = [], numOpponents = 1 } = req.body;

    if (!holeCards || holeCards.length !== 2) {
      return res.status(400).json({ error: 'Informe exatamente 2 cartas na mão' });
    }

    const opponents = Math.max(1, Math.min(9, numOpponents));

    if (!communityCards.length) {
      // Pré-flop
      const equity   = monteCarlo(holeCards, [], opponents, 3000);
      const starting = identifyStartingHand(holeCards);
      const decision = getDecision(equity);
      return res.json({
        phase: 'preflop', equity, equityPct: (equity*100).toFixed(1),
        startingHand: starting, decision,
        advice: BD.tier_descriptions[starting.tier], outs: 0, draws: []
      });
    }

    // Pós-flop
    const phase = communityCards.length===3?'flop': communityCards.length===4?'turn':'river';
    const equity = monteCarlo(holeCards, communityCards, opponents, 4000);
    const current = bestHand([...holeCards, ...communityCards]);
    const draws   = detectDraws(holeCards, communityCards);
    const totalOuts = draws.reduce((s,d) => s+d.outs, 0);
    let drawProbability = 0;
    if (totalOuts > 0 && phase !== 'river') {
      const key = String(Math.min(totalOuts, 20));
      drawProbability = phase==='flop'
        ? (BD2.outs_to_probability.flop_to_river[key]||0)
        : (BD2.outs_to_probability.turn_to_river[key]||0);
    }
    return res.json({
      phase, equity, equityPct: (equity*100).toFixed(1),
      currentHand: { name: HAND_LABELS[current.name]||current.name, rank: current.rank },
      draws, totalOuts, drawProbability: (drawProbability*100).toFixed(1),
      decision: getDecision(equity, current.rank), communityCount: communityCards.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
