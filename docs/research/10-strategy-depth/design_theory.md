# Design theory: luck mitigation in roll-and-move and comeback/catch-up mechanics

Method note for the report writer: web search worked, but every page fetch in this session failed (WebFetch DNS errors, and curl got a 403 from the proxy). So every citation below rests on search-result text that summarized the linked page; I could not read any page in full. Where a search summary called a source weak, I say so. Facts about published games that I know but could not source in this session are listed only under Inferences or Gaps, never under Cited Findings.

## 1. What is wrong with roll-and-move, and what fixes it (input vs output randomness)

### Takeaway
Critics' main charge against roll-and-move is that it removes agency: the dice choose the move, so the player has nothing to decide. This is output randomness: luck that arrives after the player's choice (here the roll decides everything and there is barely a choice at all). The accepted fixes keep the dice but put a decision next to the roll: pick among dice or pawns, choose how many dice or which range of dice, spend a resource to change a roll, or play a movement card instead of rolling. Engelstein's input/output framing is the standard lens, and Burgun is its hardline form. The one controlled study found does not simply support "input good, output bad", so treat the framing as a heuristic, not a law.

### Cited Findings
**The critique**
- Roll-and-move is called uninteresting mainly because it gives players few choices. Snakes & Ladders is "entirely automatic: there are no choices to make", and Monopoly is only a partial exception, with a mostly "binary choice: buy or don't buy" — [Mano Kent Games, "Why roll and move is a bad idea"](https://www.manokentgames.com/single-post/why-roll-and-move-is-a-bad-idea) (via search summary)
- A forum view: "roll-and-move is almost always a lousy gameplay mechanic … the exceptions … all involve giving the player more control over the rolling and moving" — [Quarter to Three forum](https://forum.quartertothree.com/t/boardgaming-in-2018/133269/2081)
- Counterpoints:
  - Roll-and-move is "super easy to balance; you can put anything you like on the board".
  - It is "shortsighted" to call low-skill mechanics bad, because games also serve ritual and social play.
  - Sources: [Playing With Rules, "Sketches, Skill Loops, and Roll and Moves"](https://playingwithrules.substack.com/p/sketches-skill-loops-and-roll-and), [Quirkworthy, "The Dreaded Roll and Move… Sort of"](https://quirkworthy.com/2020/03/12/game-design-the-dreaded-roll-and-move-sort-of/) (attribution of each quote between these two posts is from the search summary)
- A designer argues that runaway leaders are among the worst problems a game can have, and that Monopoly lets leaders run away while its catch-up is weak. The suggested fix is to give players choices from their dice rolls rather than leave everything to chance — [brandonthegamedev.com](https://brandonthegamedev.com/?p=4917)

**Input vs output randomness**
- Geoff Engelstein coined "input" and "output" randomness in his GameTek segment, and the terms were later discussed on the Ludology podcast (episode 183, Engelstein & Hova 2018).
  - Input randomness resolves before the player's decision, for example a card draw. Output randomness resolves after it, for example a combat die roll.
  - Engelstein calls the distinction "the fundamental difference between randomness that supports strategy, and randomness that undercuts strategy".
  - Sources: [Skeleton Code Machine, Input-Output Randomness Pt 1](https://www.skeletoncodemachine.com/p/input-output-randomness-part-1); [Falmouth GDD journal](https://journal.falmouth.ac.uk/sc247065/?p=534)
- Engelstein's GDC Board Game Design Day talk "White, Brown, and Pink: The Flavors of Tabletop Game Randomness" sorts randomness by noise "color". White noise is independent rolls. Brown noise is random-walk, path-dependent randomness. Pink noise lies between them — [GDC Vault 1024920](https://gdcvault.com/play/1024920/contactUs). The search summary did not cover the talk's details; the white/brown/pink definitions here are standard terminology.
- Keith Burgun's essay "Randomness and Game Design" (2014) argues that output randomness has no place in strategy games. In his view it:
  - cuts the link between game states;
  - breaks planning;
  - adds no depth;
  - "obscures the game output", because a player can play perfectly and still lose.
  - Sources: [Game Developer, "Randomness and game design"](https://gamedeveloper.com/design/randomness-and-game-design); [critpoints.net, "Visited by RNGesus"](https://critpoints.net/2017/01/16/visited-by-rngesus/)
- Pushback on Burgun:
  - Critics say random outcomes can build strategic thinking: risk assessment and hedging.
  - Mark Brown (Game Maker's Toolkit) notes that well-tuned output randomness can improve a game, and badly designed input randomness can hurt one.
  - Output randomness feels fairer when players can influence the odds; Slice & Dice is the example given.
  - Sources: [Game Developer, "How randomness contributes to strategic thinking"](https://www.gamedeveloper.com/design/how-randomness-contributes-to-strategic-thinking); [ezraszanton substack](https://ezraszanton.substack.com/p/output-randomness-game-designers)
- Empirical check: Zhang, Monteiro, Liang, Ma & Baghaei (2021) varied input and output randomness in a collectible card game.
  - Conditions: none, input only, output only, both.
  - Input randomness significantly lowered satisfaction (F(1,15)=6.275, p=0.024). Input-only scored lowest.
  - Output randomness had no significant effect on satisfaction.
  - The sample was small.
  - Source: [arXiv 2107.08437](https://arxiv.org/pdf/2107.08437)
- Richard Garfield, co-author of *Characteristics of Games* with Elias and Gutschera:
  - Luck and skill are best treated as two separate axes, not opposite ends of one scale.
  - "The more luck that's in a game, the broader [its audience] can go": luck lets weaker players win sometimes.
  - Even chess has luck in this sense, because the outcome cannot be predicted with certainty.
  - These are secondary accounts, and the exact wording was not confirmed.
  - Sources: [Board Game Design Lab, "Luck vs Skill with Richard Garfield"](https://boardgamedesignlab.com/luck-vs-skill-with-richard-garfield/); [Sloperama column](https://sloperama.com/mahjongg/column2/column808.html); [MIT Press listing](https://mitpressbookstore.mit.edu/book/9780262542692)

**Named fixes and published examples**
- **Speed by choice (gear = die range).** In Formula D:
  - Each turn the player shifts up one gear, stays, or shifts down.
  - Each gear rolls a different die, so the player chooses the range of movement, not the exact number.
  - Skipping down gears costs wear points.
  - Corners require "stops" in the zone, so the skill is picking a gear whose range lands you safely.
  - Sources: [Wikipedia: Formula D](https://en.wikipedia.org/wiki/Formula_D_(board_game)); [BGA Formula D help](https://en.doc.boardgamearena.com/Gamehelpformulad)
- **Roll, then allocate (dice placement).** In Kingsburg:
  - Players roll, then place dice sums on advisor spaces. Only one player may take each space.
  - Good play means tracking opponents' rolls and blocking them.
  - Low rolls can be split across several advisors.
  - Rerolls come from buildings and advisor powers.
  - Source: [Zen of Design, Kingsburg](https://zenofdesign.com/8-kingsburg)
- **Choose which pawn moves.** In Ghosts of the Moor, players roll one die and choose which of their meeples to move — [Board's Eye View](https://www.boardseyeview.net/post/2018/12/07/ghosts-of-the-moor)
- **Roll 3 dice, keep 2.** A designer suggestion from BGDF for track games: roll three dice and choose which two move you — [BGDF, "different twist old mechanic"](https://bgdf.com/forum/game-creation/mechanics/different-twist-old-mechanic)
- **Move cards instead of the die.** In Spy Alley, players collect Move cards they can play in place of rolling, and most spaces offer a purchase decision — [Mano Kent Games](https://www.manokentgames.com/single-post/why-roll-and-move-is-a-bad-idea)
- **No dice: pay for distance (Hare and Tortoise, David Parlett, 1974).**
  - Moving costs carrots on a triangular scale: 1 square = 1 carrot, 2 = 3, 3 = 6, 4 = 10.
  - Players earn carrots by moving back to tortoise squares (10 per square) or by waiting on carrot squares.
  - Sources disagree on starting carrots: 65 or 68.
  - Sources: [Wikipedia: Hare and Tortoise](https://en.wikipedia.org/wiki/Hare_and_Tortoise); [Mind Sports Olympiad](https://mindsportsolympiad.com/hare-and-tortoise/)
- **No dice: last player moves, any distance (Tokaido).**
  - The rearmost traveler always takes the next turn and moves as far as they like.
  - Moving a short way buys more turns. Moving far grabs spaces before others.
  - Source: [Board Game Quest, Tokaido review](https://boardgamequest.com/tokaido-board-game-review)
- **Monopoly's own speed die** (Mega Edition 2006, standard game from 2007):
  - Faces: 1, 2, 3, two "Mr. Monopoly" faces, and a bus.
  - Mr. Monopoly moves you to the next unowned property, or to the next one where you would owe rent.
  - The bus lets you move by one die or by both. This is a partial "choose your move" fix.
  - In the standard game it is used only after passing GO once.
  - No controlled data on its effect on game length was found.
  - Source: [Wikibooks: Monopoly/The Speed Die](https://en.wikibooks.org/wiki/Monopoly/The_Speed_Die)
- **Reroll and lock (Yahtzee-style).** BGG's "Re-rolling and Locking" mechanic covers King of Tokyo, Zombie Dice and Elder Sign — [VASSAL forum](https://forum.vassalengine.org/t/looking-for-dice-re-rolling-and-locking-examples/11704)
- **Rising odds after misses (Dota 2 pseudo-random distribution).**
  - Each failed attempt adds a constant C to the next chance, and the chance resets on success. A listed 25% bash is about 8.5%, then about 17%, then about 25.5% on successive hits.
  - Same long-run rate, fewer extreme streaks.
  - Sources: [Diplograph](https://diplograph.net/notes/games/randomness/dota-2-prd); [Liquipedia](https://liquipedia.net/dota2/Random_Distribution)

### Inferences
- **Fixes by how much they slow a turn.** This ordering is my own reasoning, not measured. For a dice-driven property game on one tablet, the cheapest fixes add a single binary or ternary choice at the roll:
  - roll 1, 2 or 3 dice;
  - roll 2, then choose which die or the sum;
  - an occasional reroll token;
  - a fixed-value move card.

  Hand-management systems (Tokaido or Hare and Tortoise style) turn the game into a different genre and add more thinking per turn.
- **Choosing the range rather than the number** (Formula D) keeps the drama of dice while making risk a skill.
  - In Monopoly terms: "roll 1 die to creep past a hotel strip, or 2 to jump it".
  - The choice matters only if the board has danger zones or targets at known distances. Monopoly boards do: opponents' monopolies and the Jail corner.
- **Banked or saved rolls and guaranteed-value tokens** were in the brief, but I found no primary source for them in this session. Games I know use them, but their sources are unverified here: the Catan 5-6 player pairing does not count; Cities & Knights' alchemist card lets you set the dice. List them as known patterns, unsourced.
- **The 2021 CCG study shows** that "input randomness = good" does not automatically hold for satisfaction. Players may dislike a bad draw more than a bad roll. Mitigation should therefore target what feels like "my choice didn't matter", not a randomness category.

### Gaps
- I could not read Engelstein's GameTek or "Building Blocks of Tabletop Game Design" entries. The book has per-mechanism entries with pros, cons and examples, but I could not confirm its table of contents ([listing](https://mitpressbookstore.mit.edu/book/9781032015811)).
- The exact *Characteristics of Games* text on luck and skill is unverified.
- I found no sourced examples of "dice drafting" (Roll for the Galaxy, Sagrada, Troyes), "action points instead of movement", or "banked roll" tokens; I know them only from memory, unverified here.
- I found no data on how much any single fix changes win rates.

## 2. Comeback / catch-up mechanisms: techniques, fairness, kingmaking

### Takeaway
Designers divide catch-up rules into three kinds:
1. **Gifted boosts to trailing players** (rubber bands, blue shells, bonus income for whoever is last). Often seen as punitive or gamey.
2. **Headwinds on the leader** (rising costs, diminishing returns, worse turn order). More accepted as "earned".
3. **Structural fixes** (several paths to victory, hidden or late scoring). Considered the most elegant.

In 3–4 player games, any mechanic that lets players aim at one opponent invites leader-bashing and kingmaking. The usual defenses are hidden or uncertain scores, attacks that also advance the attacker's own goal, and indirect targeting.

### Cited Findings
**Definitions and framing**
- League of Gamemakers, "Ask the League: Should games have a catch-up mechanic?":
  - Catch-up mechanics are defined as structures that give a trailing player an inherent edge.
  - James Ernest's caveat: if the trailing player gets a boost, they may not really be trailing. Catch-up mostly hides who the real leader is.
  - The author prefers **headwinds** that slow whoever pulls ahead, citing Dominion, where victory cards clog the leader's deck.
  - He also recommends several strong paths to victory, and wants VP markers to stay close together for most of the game.
  - He is skeptical of catch-up as "a patch".
  - Source: [League of Gamemakers](https://leagueofgamemakers.com/ask-the-league-should-games-have-a-catch-up-mechanic) (search summary only)
- Trade-off: comeback mechanisms that are too strong "discourage playing well at the beginning and can reward suboptimal decisions" — [culTest quiz page](https://play.ceslava.com/cultest/en/test/cat-entertainment/juegos-de-mesa/que-es-un-catch-up-mechanism-juegos-de-mesa-09/) (low-authority source)
- An academic catch-up-game paper (MPRA 108784):
  - Catch-up appears in Hare & Tortoise, in time tracks like Tokaido, and in Super Mario Kart power-ups.
  - With strong catch-up, the current score stops being a reliable signal of who is winning.
  - Source: [MPRA paper 108784](https://mpra.ub.uni-muenchen.de/108784/1/MPRA_paper_108784.pdf)

**Turn-order catch-up (Power Grid)**
- Turn order is reset every round:
  - The player with the most cities goes first. Ties go to the higher power plant.
  - Resources are bought and cities built in reverse order, so the leader buys last at higher prices, because scarcity raises the price.
  - The leader does bid first in the plant auction.
  - A strategy guide: "Turn order is a mechanism to slow down the players who are high in turn order."
  - Sources: [Wikipedia: Power Grid](https://en.wikipedia.org/wiki/Power_Grid); [BGG How To Teach: Power Grid](https://boardgamegeek.com/wiki/page/How_To_Teach:_Power_Grid)
- Reception is split:
  - One reviewer calls it "massively gamey", an obvious anti-runaway patch: "if I've played well … I want to enjoy that advantage".
  - Others note that turn-order management becomes part of the strategy, with players deliberately staying behind.
  - Sources: [There Will Be Games, "Power Grid: a calculated assessment"](https://www.therewillbe.games/articles-boardgame-reviews/1874-power-grid-a-calculated-assessment); [Board Game Meeple Lady](https://www.boardgamemeeplelady.com/?p=1171)

**Other published examples**
- **Quacks of Quedlinburg (Rat Tails):** the scoreboard gives a head start to every player except the leader, scaled by distance behind — [Zatu, games with catch-up mechanics](https://zatu.com/games-with-catch-up-mechanics/)
- **Isle of Skye:** from round 3, players get more free money the further behind they are — [Zatu](https://zatu.com/games-with-catch-up-mechanics/)
- **Tokaido:** the last-place traveler moves next, so being behind buys more actions — [Board Game Quest](https://boardgamequest.com/tokaido-board-game-review)
- **Hare and Tortoise:**
  - Falling back earns carrots (10 per square on tortoise squares).
  - Waiting on carrot squares earns carrots.
  - Source: [Wikipedia](https://en.wikipedia.org/wiki/Hare_and_Tortoise)
- **Mario Party:**
  - A "Last Five Turns" event shows the standings and adds a twist. In the original game this included coin changes and a 20-coin bonus for passing Start.
  - In later games, trailing players get a boost in the final turns, and coins on blue spaces double to six.
  - End-of-game Bonus Stars (most minigames won, most Bowser spaces, and so on) add hidden late scoring.
  - Sources: [Giant Bomb: Last Five Turns Event](https://giantbomb.com/wiki/Concepts/Last_Five_Turns_Event); [Massively Overpowered on Superstars](https://massivelyop.com/2021/11/05/massively-on-the-go-first-impressions-of-the-multiplayer-mario-party-superstars/)
- **Mario Party reception:**
  - Super Mario Party reviewers note luck-driven snowballing: someone who lucks into allies early leaves others feeling they "have no hope of catching up", and players lose "through no fault of your own".
  - One reviewer still prefers "things happening even if it means I come out the loser".
  - Fans criticize the last-five-turns boost as too strong.
  - Sources: [SlashGear review](https://www.slashgear.com/super-mario-party-review-phone-a-friend-19550439); [Gaming Trend MP10 review](https://gamingtrend.com/reviews/mario-party-10-review/); [TheTopTens (fan list, weak source)](https://www.thetoptens.com/super-mario/biggest-problems-with-mario-party-superstars/)

**Blue shell and rubber banding: the criticism**
- Law of Game Design, "Theory: Rubber Bands":
  - The blue shell "discourage[s] good decisions and promote[s] a boring style of play".
  - It punishes skill: "the better one is, the more likely one is to be the target of an unavoidable attack".
  - Rubber bands are acceptable only if they make the game more interesting "for both the followers and the leader".
  - Source: [Law of Game Design](https://lawofgamedesign.com/2014/08/25/theory-rubber-bands/)
- AV Club:
  - Rubber banding "purports to heighten the excitement … In practice … undermine[s] the very spirit of competition".
  - Item odds that favor the back of the pack encourage players to deliberately drive slower to sandbag.
  - Source: [AV Club, "5 games totally ruined by rubberbanding AI"](https://www.avclub.com/5-games-totally-ruined-by-rubberbanding-ai)
- The fan-summarized three flaws of the blue shell:
  1. Its effect falls disproportionately on the leader.
  2. The target has little counterplay.
  3. It does not help the user.

  Source: [Vice/Broadly, "The blue shell and its discontents"](https://broadly.vice.com/en/article/epngxp/the-blue-shell-and-its-discontents-2)

**Kingmaking and bashing the leader**
- Definitions:
  - **Leader bashing** (Lew Pulsipher): attacking whoever is ahead.
  - **Sandbagging**: its inverse, hiding how well you are doing.
  - **Kingmaking**: a player who cannot win decides who does.
- Known mitigations:
  - hidden victory points (these mainly reduce bashing; kingmaking persists);
  - less player interaction;
  - player elimination;
  - making it hard to target a single player;
  - keeping everyone close to victory, as in Kemet.
- In an informal poll, kingmaking (42%) and leader bashing (23%) were rated the worst problems.
- Sources: [The Thoughtful Gamer, "Losing Propositions"](https://thethoughtfulgamer.com/2017/09/16/losing-propositions/); [Skeleton Code Machine, "Is kingmaking a problem to be solved?"](https://www.skeletoncodemachine.com/p/kingmaking); [Skeleton Code Machine, "Is kingmaking cursed?"](https://www.skeletoncodemachine.com/p/is-kingmaking-cursed)
- Cole Wehrle's GDC talk "King Me: A Defense of King-Making in Board Game Design" defends player-disruption designs. Kingmaking can be accepted as part of a political game rather than solved — [GDC Vault 1025683](https://www.gdcvault.com/play/1025683/contactUs)
- **Attacks that also serve the attacker.** In "king of the hill" designs, bashing works when the attack also advances the attacker's own goal (Time of Crisis). It fails with asymmetric goals and few, heavy turns (Oath) — [Bumbling Through Dungeons](https://bumblingthroughdungeons.com/king-of-hill-combative-board-games/)

**Pity timers and bad-luck protection**
- Hearthstone guarantees a Legendary within 40 packs; the base rate is about 1 in 20. It guarantees an Epic within 10. Players inferred the timer before Blizzard documented it — [esports.gg](https://esports.gg/guides/hearthstone/hearthstone-pity-timer); [Blizzard forum](https://us.forums.blizzard.com/en/hearthstone/t/35-packs-opened-and-not-a-single-legendary/5297)
- Dota 2's pseudo-random distribution keeps the average while cutting long streaks. It came from Warcraft III — [Diplograph](https://diplograph.net/notes/games/randomness/dota-2-prd); [Dota 2 wiki](https://dota2.fandom.com/wiki/Pseudo-random_distribution)
- RuneScape documents "bad luck mitigation" for drops — [OSRS wiki](https://oldschool.runescape.wiki/w/Bad_luck_mitigation)

### Inferences
- **Earned versus gifted.** The sourced criticism converges on two tests:
  1. Does the leader keep counterplay?
  2. Does the trailing player have to do something to benefit?

  Power Grid's turn order passes: the trailing player still has to buy cheap and build well. Tokaido passes, because being behind is a resource you choose to spend. The blue shell fails both tests.

  Monopoly-like translations of the passing kind:
  - Reverse turn order for auctions or purchases.
  - Rising build costs or taxes per property the leader owns (a headwind).
  - Rebates for whoever is in last place (the "Rat Tails" pattern), only if they must still choose how to spend them.
- **Sandbagging risk.** Catch-up keyed to rank invites deliberately staying behind, the AV Club point. Scaling the bonus continuously by distance behind (Quacks), or keying it to net worth rather than position, reduces the incentive. This is my reasoning, not measured.
- **Targeting on one shared screen.** Hidden scoring is weak here because everyone sees the board. Better options:
  - indirect targeting: global events that hit the richest player automatically;
  - attacks that pay the attacker;
  - no free-choice "pick a victim" effects, the main kingmaking channel in 3–4 player games.
- **Pity timers suit a seeded, deterministic engine.**
  - Examples: "after N turns without landing on an unowned property, the next chance card offers a purchase", or a PRD-style rising chance for a good card.
  - Implement them as visible or explainable rules, since Hearthstone players found the hidden one anyway.

### Gaps
- I found no controlled player study comparing perceived fairness of headwind-style and gifted catch-up; the evidence is reviews and designer opinion.
- The full League of Gamemakers text, and anything on bounties on the leader as a mechanic, was not read.
- I found no source for "drafting order for the losing player" beyond Power Grid's reverse-order buying.

## 3. Decision quality: interesting decisions, density, analysis paralysis, planning hooks

### Takeaway
Sid Meier's "a game is a series of interesting decisions" (GDC 1989, revisited at GDC 2012) is the anchor. A decision is interesting when it is a real trade-off and its result feels personally consequential, the kind of choice where you wonder how the other option would have turned out. Analysis paralysis comes from too many options, too much calculation, or consequences that are hard to evaluate. Standard fixes:
- fewer options per turn;
- a turn split into phases;
- randomness or hidden information that makes deep calculation pointless;
- turn timers, ideally with a soft penalty.

### Cited Findings
- **Sid Meier's "Interesting Decisions" talk (GDC 2012):**
  - It revisits his GDC 1989 line "a game is a series of interesting decisions", which also appears in the form "meaningful choices".
  - It gave practical tips for making decisions more interesting.
  - Sources: [Engadget](https://www.engadget.com/2012-01-24-sid-meier-keiji-inafune-and-riot-games-folks-added-to-gdc-semin.html); [Game Developer](https://gamedeveloper.com/design/video-sid-meier-explores-interesting-decisions-in-gameplay); [GDC news](https://gdconf.com/news/gdc_vault_adds_free_gdc_2012_v)
- **Meier's memoir** (via a review): what matters is whether the player's investment feels personal and significant, and a meaningful decision leaves you wondering how a different choice would have turned out — [ybrikman.com review](https://www.ybrikman.com/blog/2026/06/18/sid-meier-memoir/)
- **"Designing interesting decisions in games (and when not to)"** is also on Game Developer — [link](https://www.gamedeveloper.com/design/designing-interesting-decisions-in-games-and-when-not-to-) (content not read)
- **Analysis paralysis: definition.** AP happens when decisions are too complex, choices too numerous, or consequences too hard to evaluate — [Engaged Family Gaming](https://engagedfamilygaming.com/gaming-definition-of-the-week-analysis-paralysis/)
- **League of Gamemakers, "Designing games to prevent analysis paralysis" (parts 1–2):**
  - Reduce opportunity cost.
  - Reduce or remove calculation.
  - Minimize visual information.
  - Use simultaneous actions.
  - Split turns into phases.
  - Start with few options.
  - Use randomness or hidden information so deep look-ahead does not pay.
  - Sources: [part 1](https://leagueofgamemakers.com/designing-games-to-prevent-analysis-paralysis-part-1); [part 2](https://www.leagueofgamemakers.com/designing-games-to-prevent-analysis-paralysis-part-2)
- **Timers:**
  - A sand timer is the quickest fix.
  - A chess-style clock gives each player a running time budget.
  - Penalties for an expired timer and "time cards" were suggested on forums.
  - AP also depends on the players, so design reduces it but cannot remove it.
  - Sources: [BGDF "how speed game play"](https://bgdf.com/forum/game-creation/mechanics/how-speed-game-play); [Skeleton Code Machine, "This player is not playing"](https://www.skeletoncodemachine.com/p/analysis-paralysis); [infinitesummer.org](https://infinitesummer.org/archives/1410)
- **Spy Alley's choices on landing.** Its fix for roll-and-move is that most spaces offer a choice, mostly of what to buy — [Mano Kent Games](https://www.manokentgames.com/single-post/why-roll-and-move-is-a-bad-idea)

### Inferences
- **Decision density per turn.** Aim for one small decision at the roll and one consequential decision on landing or at the end of the turn. Keep each to 2–4 options; this rule of thumb is drawn from the AP fixes above. A timer is a backstop, not the main tool.
  - On a shared tablet, a soft timer suits casual play better than a hard forfeit. Examples: the CPU suggests a default after N seconds, or a visible countdown with an auto-pick.
  - Its cost is that it stops slow turns from making everyone else wait, the AP "spillover cost".
- **Planning hooks** for a property game's long-term goals. The research found no source on set collection, secret objectives or contracts for this genre; these are standard patterns, unsourced here.
  - Public "contracts", for example own 2 of a color set by turn X for a bonus.
  - Owning colour groups already gives a set-collection backbone.
  - Secret objectives conflict with one-screen pass-and-play unless a private reveal is handled (the device is handed over).
- **Open versus hidden on one screen.** Open information favors honest leader-tracking, which supports headwinds. It also makes bashing easier, which argues for automatic rather than player-targeted catch-up (section 2).

### Gaps
- I found no measured data on optimal decisions per turn, or on how long a casual player tolerates waiting per turn.
- I found no primary source for Meier's full list of criteria; the talk itself was not read.
- I found no sources on secret objectives and contracts in roll-and-move property games specifically.

## 4. Session length and pacing (casual, party and mobile board games)

### Takeaway
Hard data is scarce. Monopoly's published length figures come from weak sources (roughly 60–90+ minutes, longer with house rules), and its reputation for running long and letting a leader be "hard to dislodge" is widespread. The patterns for accelerating the end game:
- a final-phase event with doubled payouts and catch-up (Mario Party's "Last Five Turns");
- end-of-game bonus awards;
- Monopoly's speed die, which pushes players toward properties they would otherwise skip;
- a fixed turn or round count instead of bankruptcy elimination.

### Cited Findings
- **Monopoly length figures, all weak:**
  - 60–90 min for 4 players;
  - a cited (unlocatable) 2008 survey at about 75 min mean, with about 25% of games over 2 hours;
  - one self-reported sample of 345 two-player games at 84 min, rising to 156 min with house rules such as a Free Parking jackpot.

  The search summary flagged all of these as weak or content-farm sources — [ExpertBeacon](https://expertbeacon.com/how-long-does-a-2-player-game-of-monopoly-take/); [Gitnux](https://gitnux.org/monopoly-statistics/)
- **Parker Brothers' stated length.** A trivia source says Parker Brothers puts the "right" length of a game at about 45 minutes, while games often run for hours — [KidsSearch trivia](https://www.kidssearch.com/trivia-questions-answers/hobbies/although-the-parker-brothers-company-states-that-the-right-length-of-a-monopoly-game-should-be-about-45-minutes-the-game-often-continues-for-hours-bec.php) (weak)
- **Monopoly's reputation.** It is criticized as a slow grind where the top player is hard to dislodge — [TASVideos](https://tasvideos.org/6074M)
- **Speed die and Monopoly Speed:**
  - The speed die exists to speed up the game.
  - Monopoly Speed, a separate edition, targets about 10 minutes.
  - No controlled data on the speed die's effect on length was found.
  - Sources: [Wikibooks Speed Die](https://en.wikibooks.org/wiki/Monopoly/The_Speed_Die); [Monopoly Wiki: Speed Edition](https://monopoly.fandom.com/wiki/Speed_Edition)
- **Mario Party's end-game acceleration:**
  - A "Last Five Turns" event shows the standings and changes the rules: doubled coins, catch-up bonuses.
  - Bonus Stars are awarded at the end.
  - A reviewer calls "long games that could have fairly random winners" unfun, and says Superstars' tweaks address most of this.
  - Sources: [Giant Bomb](https://giantbomb.com/wiki/Concepts/Last_Five_Turns_Event); [Massively Overpowered](https://massivelyop.com/2021/11/05/massively-on-the-go-first-impressions-of-the-multiplayer-mario-party-superstars/)
- **Monopoly GO (mobile).** It is asynchronous and energy-gated: dice regenerate over time, which caps session length. No session-length figure was found — [PlayNews guide](https://www.playnews.gg/guides/monopoly-go-le-guide-de-demarrage-complet-en-2026)
- **Rento Fortune.** A third-party listing estimates an average session of about 30 minutes; this is not developer data — [itch.io Rento](https://boardgamesonline.itch.io/rento-monopoly); [SteamSpy](https://steamspy.com/app/663390)

### Inferences
- **Session target.** For pass-and-play on a tablet, a 20–40 minute target is consistent with Rento's estimate and Mario Party's structure (10–30 turns), but it is unproven.
- **Ending rules.** A fixed turn count combined with a net-worth victory removes Monopoly's long elimination tail. A final-phase rule change (last N turns: doubled rent or payouts and catch-up rebates) keeps the end tense.
- **Risk of the final-phase change.** Fans complain the Mario Party end boost is "too easy" or too strong, so keep the final-phase catch-up small and earned: rebates to spend, not free stars.

### Gaps
- I found no rigorous data on how long casual players tolerate a board game session, mobile or tabletop.
- I found no published study on how the speed die, or turn limits, change Monopoly game length or winner variance.

## 5. Measuring strategic depth (skill vs luck)

### Takeaway
There are two practical methods.

**Method 1: Elo spread** (Duersch, Lambrecht & Oechssler 2020):
- Fit Elo ratings to many games. A wider spread of ratings means more skill.
- Calibrate against "x%-chess": chess with x% of results replaced by coin flips. A game below 50%-chess is mostly luck. Poker is about 25%-chess.

**Method 2: agent-based simulation:**
- Pit agents of graded strength (random < heuristic < search-based such as MCTS) against each other.
- Read skill-depth from how reliably stronger agents win, and how that changes as design parameters change.
- Many repeated runs are needed, because dice add noise.

### Cited Findings
- **Duersch, Lambrecht & Oechssler, "Measuring skill and chance in games"** (*European Economic Review* 127, 2020, 103472; Heidelberg DP 643, 2017):
  - Ranks players with a "best-fit" Elo algorithm. The spread of ratings measures the role of skill.
  - The benchmark is "50%-chess", relevant for courts that classify games as games of chance.
  - Poker has about as much skill as chess with 75% of results replaced by coin flips.
  - Most popular online games, including poker, fall below 50% skill.
  - Go has more skill than chess. Mau-Mau has far less than poker.
  - Datasets: chess, poker, backgammon, tetris, Skat.
  - Sources: [Hanken research portal](https://research.hanken.fi/en/publications/measuring-skill-and-chance-in-games/); [Heidelberg DP pdf](https://www.awi.uni-heidelberg.de/md/awi/professuren/with2/duersch_lambrecht_oechssler_2017_dp0643.pdf); [Uni Heidelberg press release "Skat and Poker: More Luck than Skill?"](https://www.uni-heidelberg.de/en/newsroom/skat-and-poker-more-luck-than-skill)
- **Liu, Togelius, Perez-Liebana & Lucas, "Evolving Game Skill-Depth using General Video Game AI Agents"** (CEC 2017):
  - Estimates skill-depth by having AI agents of varied strength playtest a game, then evolves game parameters to increase it.
  - The search-based agent's win rate ranged from 20% to 100% across parameter settings. One cost parameter (missile cost) was the most influential.
  - Choosing a resampling count to handle noise was essential.
  - Source: [arXiv 1703.06275](https://arxiv.org/abs/1703.06275)
- **Simulation-based strategy analysis with Monte Carlo Tree Search** (Scrabble example):
  - Higher-skilled agents consistently beat lower-skilled ones, which shows the game rewards skill.
  - The same method also checks first-move advantage.
  - Source: [arXiv 1908.01423](https://arxiv.org/pdf/1908.01423)
- **Noise from dice.** With dice, winners differ between simulation runs, so balance needs many repetitions: "when playing many times, skill should make the difference" — [arXiv 2306.04429](https://arxiv.org/pdf/2306.04429)
- **Survey of agent-based gameplay analysis.** In Dominion, different agent strategies were compared to find cards common to winning sets — [arXiv 1811.06962](https://ar5iv.arxiv.org/html/1811.06962)
- **Caution.** AI play is "not currently predictive of human play". One proposal is to reduce balance questions to win rates between asymmetric agents — [AAAI paper](https://cdn.aaai.org/ojs/12513/12513-52-16035-1-2-20201228.pdf)

### Inferences
These are recommended metrics for a seeded-RNG engine with a balance simulator. They are my synthesis of the sources above.

1. **Skill gap.** The win rate of a strong agent (lookahead or MCTS) against 3 random or naive agents.
   - The 4-player luck baseline is 25%.
   - Report the gap across many seeds, with confidence intervals.
   - Run it before and after each mitigation mechanic.
2. **Elo-spread or "x%-chess" style.** Fit ratings over a tournament of agents of graded strength. A wider spread means more skill expression.
3. **Variance decomposition.**
   - Hold the agent policy fixed and vary the seeds; separately hold the seeds fixed and vary the policy.
   - The share of outcome variance explained by policy is a skill proxy.
   - The seeded RNG makes paired comparisons (same seed, different policy) cheap and lower-variance.
4. **Comeback metrics.**
   - P(win | in last place at turn T) for several values of T.
   - How often the lead changes.
   - Final net-worth spread.
   - Targets: last place at mid-game should keep a non-trivial chance, but well below 25% for the strong agent's opponents, so comebacks stay earned.
5. **Kingmaking proxy.** The rate of games where a player out of contention takes an action that changes the eventual winner. Measure it by counterfactual replay from the same seed.
6. **Pace.** The distribution of turns and actions per game, the fraction of turns with a non-trivial choice (more than one legal option), and the mean options per decision, a proxy for analysis-paralysis risk.

### Gaps
- I did not read the Duersch paper's full numeric tables (fetch blocked), so exact rating standard deviations per game are unavailable.
- No published skill measurement for Monopoly or other roll-and-move games was found.
- I found no source validating that AI-measured skill gaps match human-perceived strategy depth in casual games; the AAAI paper warns they may not.
