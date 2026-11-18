import { uid, normTitle } from './model.js';

// "A > B > C | B > D": after "|", the chain continues from the latest visit of its first article in this trail.
function build(name, spec, daysAgo) {
  const visits = [];
  const last = new Map();
  for (const seg of spec.split('|')) {
    const parts = seg.split('>').map(normTitle).filter(Boolean);
    let parent = last.get(parts[0]) ?? null;
    let start = 0;
    if (parent == null && visits.length === 0) {
      const v = { id: uid(), article: parts[0], parent: null };
      visits.push(v); last.set(v.article, v.id); parent = v.id; start = 1;
    } else start = 1;
    for (let i = start; i < parts.length; i++) {
      const v = { id: uid(), article: parts[i], parent };
      visits.push(v); last.set(v.article, v.id); parent = v.id;
    }
  }
  return { id: uid(), name, created: new Date(Date.now() - daysAgo * 864e5).toISOString(), visits };
}

export function exampleState() {
  return {
    version: 2,
    lang: 'en',
    trails: [
      build('', 'Graph theory > Leonhard Euler > Seven Bridges of Königsberg > Eulerian path | Leonhard Euler > Euler\'s identity > Complex number', 9),
      build('', 'Neuron > Synapse > Neurotransmitter > Dopamine | Neuron > Action potential > Ion channel', 7),
      build('Brain to graphs', 'Brain > Neuron > Synapse > Hebbian theory > Neural network (machine learning) > Graph theory > Leonhard Euler', 6),
      build('', 'Neural network (machine learning) > Backpropagation > Gradient descent | Neural network (machine learning) > Perceptron > Frank Rosenblatt', 4),
      build('', 'Brain > Neuron > Synapse > Hebbian theory > Donald O. Hebb | Hebbian theory > Neural network (machine learning) > Backpropagation > Gradient descent', 2),
      build('', 'Complex number > Euler\'s identity > Leonhard Euler > Graph theory > Directed acyclic graph > Topological sorting', 1),
    ],
  };
}
