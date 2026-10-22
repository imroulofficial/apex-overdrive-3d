// The Apex Expedition story: a lightweight comic-book layer over the career. Scenes play as
// portrait panels and speech boxes (ui/dialogue.js) before key stages and boss duels, and once
// after each boss falls. Pure data (no browser APIs), so the tests can import it under Node.
//
// Scene triggers:
//   'prologue'            the first time the world map opens
//   { stage, when }       'before': opening that stage's briefing; 'after': the first time
//                         that stage's star 1 is earned (boss victories)
// Played scene ids are kept per device in save.story.seen; every scene can be skipped and
// replayed from the briefing.

// `side`: which edge of the panel the portrait sits on. `palette` drives the procedural
// portrait (ui/portraits.js) and the name plate.
export const CAST = {
  elena: {
    id: 'elena',
    name: 'Elena Vance',
    role: 'Crew Chief',
    side: 'left',
    palette: { skin: '#e2a77f', hair: '#8c2f1c', accent: '#ff7a1a', suit: '#1d2333' },
  },
  rookie: {
    id: 'rookie',
    name: 'Rookie',
    role: 'Red Pen Racing',
    side: 'left',
    palette: { skin: '#c98b62', hair: '#1a1410', accent: '#ff2a3a', suit: '#c8102e' },
  },
  riptide: {
    id: 'riptide',
    name: 'Riptide',
    role: 'Coastal Champion',
    side: 'right',
    palette: { skin: '#a8714d', hair: '#0b2f4a', accent: '#19b5c4', suit: '#0d2a6b' },
  },
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche',
    role: 'Master of the Pass',
    side: 'right',
    palette: { skin: '#f0c9a8', hair: '#e9edf2', accent: '#7fd3ff', suit: '#3b4250' },
  },
  kage: {
    id: 'kage',
    name: 'Kage',
    role: 'Shadow of Neon City',
    side: 'right',
    palette: { skin: '#8a5a3c', hair: '#0a0a0f', accent: '#ff2bd6', suit: '#121317' },
  },
};

// Accent colour of each chapter's comic panels.
export const CHAPTER_INKS = { 'emerald-coast': '#19b5c4', 'alpine-summit': '#7fd3ff', 'neon-city': '#ff2bd6' };

// Bosses in the race data (data/rivals.js BOSSES) and who voices them here.
export const BOSS_CAST = { 'boss-tidebreaker': 'riptide', 'boss-avalanche': 'avalanche', 'boss-voltage': 'kage' };

// `mood`: 'shout' draws a jagged burst balloon, 'whisper' a dashed one. `caption` lines are
// narration boxes with no speaker.
const line = (who, text, mood) => ({ who, text, ...(mood ? { mood } : {}) });
const caption = (text) => ({ who: null, text });

export const SCENES = {
  prologue: {
    id: 'prologue',
    trigger: 'prologue',
    chapterId: 'emerald-coast',
    title: 'The Apex Expedition',
    lines: [
      caption('Every summer, three regions open their roads to one tournament: the Apex Expedition.'),
      caption('Emerald Coast. Alpine Summit. Neon City. Each one ruled by a champion nobody has beaten in years.'),
      line('elena', "So you're the rookie Red Pen Studio sent me. Elena Vance, crew chief. I keep you fast, you keep the car in one piece."),
      line('rookie', 'One piece. Got it. Mostly.'),
      line('elena', 'Sixty stages stand between you and the Apex crown. Every stage has three stars: finish, skill and mastery. Stars open roads.'),
      line('elena', 'Win enough on the coast and you earn a duel with its champion. Beat all three champions and the Expedition is yours.'),
      line('riptide', 'Another rookie on my coast? Enjoy the view from the back of the grid.', 'shout'),
      line('elena', "That's Riptide, the Coastal Champion. Don't take the bait. Not yet. Let's start with Stage 1."),
    ],
  },
  'ec-10': {
    id: 'ec-10',
    trigger: { stage: 'ec-10', when: 'before' },
    chapterId: 'emerald-coast',
    title: 'Halfway Down the Coast',
    lines: [
      line('elena', "Ten stages in and the crews are talking about you. That's good. It also means Riptide is watching."),
      line('riptide', "Cute drifts. The coast road isn't a parking lot, rookie. The fog rolls in, the cliffs get closer."),
      line('rookie', 'Then I guess I will see you through the fog.'),
      line('elena', 'Smash the barricades, chain the drifts, and bank every star you can. You will need them for what comes next.'),
    ],
  },
  'ec-20': {
    id: 'ec-20',
    trigger: { stage: 'ec-20', when: 'before' },
    chapterId: 'emerald-coast',
    title: 'Boss Duel: Riptide',
    boss: true,
    lines: [
      caption('The Grand Coastal Tour. Rain on the asphalt. One rival on the grid.'),
      line('riptide', 'Three laps. You and me. When the tide turns, rookie, it turns hard.', 'shout'),
      line('elena', 'Riptide brakes late and boosts early. Stay in the slipstream, wait for the long straight, then go.'),
      line('rookie', 'Ride the draft, pass on the straight. Simple.'),
      line('riptide', 'Simple is how they all start.'),
    ],
  },
  'ec-20-after': {
    id: 'ec-20-after',
    trigger: { stage: 'ec-20', when: 'after' },
    chapterId: 'emerald-coast',
    title: 'The Tide Turns',
    lines: [
      line('riptide', "...I didn't see that pass coming. Nobody passes me in the rain."),
      line('riptide', "Fine. You earned the coast. But the Alpine road eats coast drivers. Ask Avalanche."),
      line('elena', 'One champion down! Pack the snow tires, rookie. Alpine Summit opens once you have 30 stars.'),
    ],
  },
  'as-01': {
    id: 'as-01',
    trigger: { stage: 'as-01', when: 'before' },
    chapterId: 'alpine-summit',
    title: 'Chapter 2: Alpine Summit',
    lines: [
      caption('Thin air. Hairpins stacked on hairpins. A glacier watching from above.'),
      line('elena', 'Welcome to the Alpine Summit. Cold tires, colder rivals. The Alpine Club does not like newcomers.'),
      line('rookie', 'Coast champion coming through. They will like me fine.'),
      line('avalanche', 'They said a rookie took the coast. The mountain does not care what you took.', 'whisper'),
    ],
  },
  'as-10': {
    id: 'as-10',
    trigger: { stage: 'as-10', when: 'before' },
    chapterId: 'alpine-summit',
    title: 'Snow Line',
    lines: [
      line('avalanche', 'Ten stages up my mountain. Most turn back at the snow line.'),
      line('rookie', 'I like the snow line. It shows off my drift marks.'),
      line('elena', 'Focus. Avalanche brings down the whole field with one block on a hairpin. Exit clean and use your nitro out of the corners.'),
    ],
  },
  'as-20': {
    id: 'as-20',
    trigger: { stage: 'as-20', when: 'before' },
    chapterId: 'alpine-summit',
    title: 'Boss Duel: Avalanche',
    boss: true,
    lines: [
      caption('The Summit Loop. Fog on the peaks. The Master of the Pass is waiting.'),
      line('avalanche', 'On this mountain I have never lost a duel. Not in fog, not in snow, not to anyone.', 'shout'),
      line('elena', 'Avalanche is fastest on the straights, slower through the hairpins. Win the corners and you win the race.'),
      line('rookie', 'Every corner. Got it.'),
    ],
  },
  'as-20-after': {
    id: 'as-20-after',
    trigger: { stage: 'as-20', when: 'after' },
    chapterId: 'alpine-summit',
    title: 'Avalanche Falls',
    lines: [
      line('avalanche', 'The mountain chose you today. Do not expect it twice.'),
      line('avalanche', "Below us the city lights are already on. Kage will have seen this race. Kage sees everything."),
      line('elena', 'Two champions. One left. Earn 75 stars and Neon City opens its gates.'),
    ],
  },
  'nc-01': {
    id: 'nc-01',
    trigger: { stage: 'nc-01', when: 'before' },
    chapterId: 'neon-city',
    title: 'Chapter 3: Neon City',
    lines: [
      caption('Midnight. Wet streets mirror a thousand signs. The Neon Syndicate owns every block.'),
      line('elena', "Neon City. Tight streets, wet roads, and a crew that races for keeps. Nothing here is a warm-up."),
      line('kage', 'Two champions fall and the city sends me a postcard. I will answer in person. Eventually.', 'whisper'),
      line('rookie', 'Was that... over the team radio?'),
      line('elena', 'Kage likes to make an entrance. Ignore it and drive.'),
    ],
  },
  'nc-10': {
    id: 'nc-10',
    trigger: { stage: 'nc-10', when: 'before' },
    chapterId: 'neon-city',
    title: 'Shadows on the Bridge',
    lines: [
      line('kage', 'You drift well for a tourist. The Syndicate is starting to sweat.'),
      line('rookie', 'Then come out and race me yourself.'),
      line('kage', 'Patience. The Neon Grand Prix is where shadows race. Bring all your stars.', 'whisper'),
      line('elena', "Bank every star you can. When Kage finally shows, you'll want every upgrade we can buy."),
    ],
  },
  'nc-15': {
    id: 'nc-15',
    trigger: { stage: 'nc-15', when: 'before' },
    chapterId: 'neon-city',
    title: 'Static on the Skyline',
    lines: [
      caption('Every billboard on the Neon Mile flickers at once. For one frame, they all show the same word: KAGE.'),
      line('kage', 'Fifty-four stages. You have earned a look at the car you will be chasing.', 'whisper'),
      line('rookie', 'Nice light show. Does it come with a race?'),
      line('kage', 'Five more stages. Then the Grand Prix, in the storm. Win, and the city is yours. Lose, and you were never here.'),
      line('elena', 'Kage owns the night signal, not the road. Out here a fast lap is still a fast lap. Bank the stars.'),
    ],
  },
  'nc-20': {
    id: 'nc-20',
    trigger: { stage: 'nc-20', when: 'before' },
    chapterId: 'neon-city',
    title: 'Final Duel: Kage',
    boss: true,
    lines: [
      caption('The Neon Grand Prix. Three laps through the heart of the city as a thunderstorm breaks over the skyline. The last duel of the Apex Expedition.'),
      line('kage', 'Riptide, Avalanche... they raced you. I am going to erase you.', 'shout'),
      line('elena', 'Kage never makes a mistake, so you cannot wait for one. Perfect exits, Pulse nitros, all race long.'),
      line('elena', 'Watch for the magenta light trail. Where it bends, Kage braked. Brake later.'),
      line('rookie', "From the back of the grid on the coast to here. Let's finish it."),
    ],
  },
  'nc-20-after': {
    id: 'nc-20-after',
    trigger: { stage: 'nc-20', when: 'after' },
    chapterId: 'neon-city',
    title: 'Apex Champion',
    lines: [
      line('kage', "...So that's what it looks like from behind. I never saw you pass."),
      line('riptide', 'Told you the rookie was trouble.'),
      line('avalanche', 'The mountain, the coast, the city. All of it, in one season.'),
      line('elena', 'Rookie... no. Champion. The Apex Expedition is yours. Now go get the last stars. I know you want them.'),
      caption('Above the Neon Mile, every billboard changes at once. This time they all read the same name, and it is not Kage.'),
      caption('Apex Expedition complete. Thanks for racing with Red Pen Studio.'),
    ],
  },
};

export const sceneList = Object.values(SCENES);

// The scene that plays `when` ('before' | 'after') a stage, if any.
export const sceneForStage = (stageId, when = 'before') =>
  sceneList.find((s) => s.trigger !== 'prologue' && s.trigger.stage === stageId && s.trigger.when === when) ?? null;
