# 02 — IP, Trademark and Asset-Licensing Research

> **Not legal advice.** This is a research memo compiled by an AI assistant from public web sources for an indie studio's internal planning. Have a licensed IP attorney (US and Korea) review before launch, especially the final title, store listing and any trademark filing.

- Project: original roll-and-move property-trading board game, Android, pass-and-play on one tablet, 4 players
- Inspirations to stay clear of: Monopoly (Hasbro), 부루마불 / "Blue Marble" (씨앗사, Korea), 모두의마블 (Netmarble)
- Research date: 2026-09-29

**Method and limits (read first).** Research was done with web search. Most primary-source sites (copyright.gov, Justia, namu.wiki, Korean news) were blocked from direct fetch in this environment, so many case details below come from search-result summaries of those pages, not from reading the full opinions. Items are tagged:

- **[V]** = confirmed in at least one search-result source cited next to it
- **[B]** = background knowledge, not re-verified in this session; verify before relying on it
- Title "collision checks" in section 5 were **web-search screens only**, not real trademark searches. They are not clearance.

---

## 0. One-page decision summary

1. **Rules and mechanics are free to copy; expression is not.** Roll dice, move around a loop, buy, pay rent, upgrade, jail-like skip, card spaces, auctions, trades, bankruptcy: all free genre mechanics. Both US and Korean courts say so (sections 1.1 to 1.4).
2. **The risk is not the rules, it is the "skin".** Names, logos, mascot, card names, board art, color-set layout, and the overall look and feel are where Hasbro, Seed(씨앗)/Blue Marble and Netmarble can object (trademark, trade dress, copyright in art, unfair competition).
3. **Korean precedent is favorable but narrow.** 모두의마블 won at three levels against the 부루마불 developer, but Netmarble had itself renamed 우주여행 to 세계여행 and 황금열쇠 to 찬스/포춘카드 and drew different art. The court still noted intent to "ride on popularity". Do not treat the win as license to copy a specific board (section 1.5).
4. **Korean law is moving toward protecting the combination of game elements** (Farm Heroes Saga, Supreme Court 2019). Avoid a 1:1 clone of any single Korean title's set of rules + presentation + progression (section 1.6).
5. **Avoid the strings** MONOPOLY / -POLY, 마블 / 마불, 모두의, 황금열쇠, Chance, Community Chest, Go, Free Parking, Boardwalk, Park Place, Mr. Monopoly / Rich Uncle Pennybags, top hat / monocle / tycoon-man mascot (section 2).
6. **Assets:** use OFL fonts, MIT/ISC/CC0 icons and CC0 sounds; credit CC BY items in an in-app "Credits / Open-source licenses" screen (section 4).
7. **Recommended title:** **Lot & Roll / 랏앤롤** (section 5), pending formal clearance.

---

## 1. What is protectable and what is not

### 1.1 US copyright: rules and methods are excluded, expression is protected

| Element | Protected by US copyright? | Basis |
|---|---|---|
| Idea for a game, method of play, scoring, rules as such | **No** | 17 U.S.C. 102(b) (ideas, procedures, processes, systems, methods of operation); Copyright Office Circular 33 |
| Game name / title | **No** (copyright); may be trademark | Circular 33 [V] |
| Text of the rulebook (creative wording) | **Yes** (literary work) | Circular 33 [V] |
| Board artwork, card illustrations, box art, mascot art | **Yes** (pictorial/graphic work) | Circular 33 [V] |
| Software code, audio, original UI art | **Yes** | standard |

Circular 33 (as summarized in the search result): the idea for a game, its name/title, and the methods for playing it are not protected; the text of the rules and the graphic art on the gameboard or container may be. **[V]**
- https://www.copyright.gov/circs/circ33.pdf
- https://www.copyright.gov/register/tx-games.html

### 1.2 Case law (US)

**Tetris Holding, LLC v. Xio Interactive, Inc., 863 F. Supp. 2d 394 (D.N.J. May 30, 2012)** [V]
- Xio's "Mino" copied Tetris's look and feel (visual appearance, board proportions, piece set, etc.). Summary judgment for Tetris on copyright and trade dress.
- The court used abstraction-filtration-comparison: rules and functional elements filtered out; the *specific expression* (how the game looks and is presented) was still substantially similar.
- **Takeaway for us:** copying the mechanics is legal, but *copying mechanics plus a matching visual presentation* is what lost this case. The board layout, art style, and UI must be our own.
- https://www.courtlistener.com/opinion/8715588/tetris-holding-llc-v-xio-interactive-inc/
- https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.
- https://www.loeb.com/en/insights/publications/2012/06/tetris-holding-llc-v-xio-interactive-inc
- Related (mobile clone dispute, pointer only): https://en.wikipedia.org/wiki/Spry_Fox,_LLC_v._Lolapps,_Inc.

**DaVinci Editrice S.r.l. v. ZiKo Games, LLC, No. 4:13-cv-03415 (S.D. Tex. Apr. 27, 2016)** [V]
- Card game *Bang!* vs *Legends of the Three Kingdoms*; parties agreed the rules were nearly identical. Court held method of play and rules are not protectable and found nothing "expressive" in the mechanics; the art was not substantially similar, so no infringement.
- **Takeaway:** a clone of rules with different art and names is legally safe in the US. It is the leading modern tabletop authority for this point.
- https://law.justia.com/cases/federal/district-courts/texas/txsdce/4:2013cv03415/1134359/73/
- https://www.govinfo.gov/app/details/USCOURTS-txsd-4_13-cv-03415
- https://www.gamedeveloper.com/business/texas-court-affirms-game-mechanics-not-protected-under-copyright-law

**Landsberg v. Scrabble Crossword Game Players, 736 F.2d 485 (9th Cir. 1984)** [V that it exists and concerns game strategy/rules; cite check advised] and **Allen v. Academic Games League of America, 89 F.3d 614 (9th Cir. 1996)** [B]: game rules/methods are not copyrightable; only the expression.
- Overview: https://ilr.law.uiowa.edu/sites/ilr.law.uiowa.edu/files/2022-11/Intellectual%20Property%20and%20Tabletop%20Games.pdf
- Overview: https://scholarlycommons.law.wlu.edu/cgi/viewcontent.cgi?article=1734&context=wlufac

**Anti-Monopoly, Inc. v. General Mills Fun Group, 611 F.2d 296 (9th Cir. 1979); 684 F.2d 1316 (9th Cir. 1982)** [V in outline]
- Ralph Anspach's "Anti-Monopoly" game led to a decades-long fight over whether MONOPOLY was generic. The Ninth Circuit in 1982 concluded the term had become generic as the name of the game, invalidating the registration. Congress then enacted the **Trademark Clarification Act of 1984**, which changed the genericness test to consumers' understanding of the mark as an *indicator of source*; Parker Brothers/Hasbro hold valid MONOPOLY trademarks today. [V for Congress's 1984 fix via https://grr.com/publications/monopoly-trademark-hasbros-monopoly/ summary]
- **Takeaway:** Do not rely on the "Monopoly is generic" argument; it was legislatively overridden. Also, "Ghettopoly" ended in a default judgment for Hasbro (https://en.wikipedia.org/wiki/Ghettopoly). Anything that riffs on the name or board is a bad idea.
- https://law.justia.com/cases/federal/appellate-courts/F2/684/1316/40646/
- https://law.justia.com/cases/federal/appellate-courts/F2/611/296/276886/
- https://www.quimbee.com/cases/anti-monopoly-inc-v-general-mills-fun-group-inc
- https://en.wikipedia.org/wiki/History_of_Monopoly

**Baker v. Selden, 101 U.S. 99 (1879)** [B]: the foundation of the idea/expression and method-of-operation doctrine.

### 1.3 Trademark and trade dress (US)

Hasbro's standard notice states that the **Hasbro and Monopoly names and logos, the distinctive design of the gameboard, the four corner squares, the Mr. Monopoly name and character, and each of the distinctive elements of the board and playing pieces are trademarks of Hasbro** for its property trading game and game equipment. [V]
- https://instructions.hasbro.com/en-us/instruction/monopoly-go
- https://apps.apple.com/us/app/monopoly-the-board-game/id1477966166

Secondary commentary reports registrations covering the board design, iconic artwork (railroad icon; Jail / Go to Jail / Free Parking imagery), the Chance and Community Chest card designs, and the money layout. [V as commentary, not verified against USPTO records]
- https://grr.com/publications/monopoly-trademark-hasbros-monopoly/
- https://www.americanbar.org/groups/intellectual_property_law/resources/landslide/archive/not-playing-around-board-games-intellectual-property-law/
- https://www.mondaq.com/unitedstates/trademark/1433628/trademark-protection-for-board-games-unlock-the-potential-of-trade-dress-for-your-board-game

Mr. Monopoly / Rich Uncle Pennybags: character with trademark and copyright protection; appeared on Chance/Community Chest cards from 1936 and was renamed Mr. Monopoly in the late 1990s. [V] https://en.wikipedia.org/wiki/Mr._Monopoly

How the categories work (plain terms):

| Concept | What it protects | Applies to us because |
|---|---|---|
| **Word mark** (MONOPOLY, CHANCE, COMMUNITY CHEST, etc.) | Source-identifying names; infringement = likelihood of confusion | Title, space names, card names, store listing, keywords |
| **Design mark / logo** | Specific logos, mascot silhouette | Mascot, app icon, splash screen |
| **Trade dress** | Overall look of a product that signals its source *if non-functional and distinctive/recognized* | Board layout + color scheme + corner squares + card back colors + money style used together |
| **Copyright** | Specific artwork, text | Any traced/copied art, icon drawings, rule text |
| **Dilution** (famous marks) | Blurring/tarnishment even without confusion | MONOPOLY, Mr. Monopoly may qualify as famous [B] |

Trade-dress note [B]: functional features (a square loop, 40 spaces) cannot be trade dress; the *combination* of non-functional aesthetic choices can. Keep our board shape, tile proportions, color-set scheme and corner treatments visibly different.

### 1.4 Korean law equivalents

| Concern | Korean statute | Notes |
|---|---|---|
| Copyright | **저작권법** (Copyright Act) | Protects "creative expression"; ideas/rules excluded via the 아이디어·표현 이분법 (idea/expression dichotomy). Rulebook text, art, code, music protected. |
| Trademark | **상표법** | Word marks (부루마불, 모두의마블, 황금열쇠 if registered), logos. Use KIPRIS to search (https://www.kipris.or.kr/). |
| Unfair competition | **부정경쟁방지 및 영업비밀보호에 관한 법률** (부정경쟁방지법), Art. 2 subpara. 1 | 가목/나목: confusion with well-known indicia (names, trade dress). Catch-all for unauthorized use of another's substantial investment/effort ("성과 등 무단사용"); this clause was 차목 when added in 2013, then renumbered, and is now cited as **파목** (renumbering: search results describe it as 2013 차목, later 카목, now 파목 after 2018 and 2022 amendments; confirm the current letter against the official text). |
| Product-shape/design | 디자인보호법 | Only if registered designs exist |

- Statute text: https://www.law.go.kr/lsInfoP.do?lsId=000308&ancYnChk=0
- Catch-all clause guide: https://www.kimchang.com/ko/insights/detail.kc?sch_section=4&idx=21357 and https://www.lawtimes.co.kr/news/articleView.html?idxno=163707
- Korean board-game IP overview: https://www.nepla.net/post/%EB%B3%B4%EB%93%9C%EA%B2%8C%EC%9E%84%EA%B3%BC-%EC%A0%80%EC%9E%91%EA%B6%8C and https://www.hsad.co.kr/kor/insight/h/%EC%A0%80%EC%9E%91%EA%B6%8C-%ED%86%BA%EC%95%84%EB%B3%B4%EA%B8%B0-10-%EA%B2%8C%EC%9E%84%EC%97%90-%EA%B4%80%EB%A0%A8%EB%90%9C-%EC%A0%80%EC%9E%91%EA%B6%8C

### 1.5 The Korean case: 아이피플스 v. 넷마블 (부루마불 v. 모두의마블), 2016 to 2018

**Facts** [V]: 아이피플스 (developer of the mobile 부루마불, licensed from 씨앗사) sued Netmarble in Nov 2016 (about KRW 5 billion damages sought plus injunction) alleging 모두의마블 copied 부루마불's rules and expression; claims were copyright infringement and unfair competition (부정경쟁방지법 Art. 2(1) catch-all, formerly 차목) / tort.
- https://v.daum.net/v/20161123140506693

**Outcome** [V]: Netmarble won at every level.
- **1st instance:** Seoul Central District Court, Civil Div. 62, case 2016가합570805 (decided late 2017). Plaintiff lost. https://casenote.kr/%EC%84%9C%EC%9A%B8%EC%A4%91%EC%95%99%EC%A7%80%EB%B0%A9%EB%B2%95%EC%9B%90/2016%EA%B0%80%ED%95%A9570805
- **2nd instance:** Seoul High Court Civil Div. 4 (Apr 2018). Plaintiff lost. https://www.etoday.co.kr/news/view/1618440 , https://zdnet.co.kr/view/?no=20180430094103
- **Supreme Court:** appeal dismissed (reported as a non-hearing 심리불속행 dismissal; one source dates it 2018-08-16, news coverage 2018-09-19). https://news.mtn.co.kr/news-detail/2018091913574246160

**Reasoning (as reported)** [V]:
- Rules and progression are "common or typical" in real-estate-trading board games that pre-date 부루마불 (지주놀이 / Landlord's Game, Monopoly). A square board with land spaces in a row and deed-based trading is a genre convention. It "cannot be monopolized" by one party.
- Board spaces split into three kinds, and costs rising with distance from Start: similar to Monopoly, so no originality unique to 부루마불.
- 무인도 (deserted island as the "stuck" space) is a "common, typical" expression. Court applied **scènes à faire** (standard-expression) doctrine to the island / space-travel imagery and board design.
- **Key distinguishing facts:** in 모두의마블 the equivalent of 우주여행 is named 세계여행 and of 황금열쇠 is 찬스/포춘카드, and the drawn art differs. 모두의마블 also added extra fun elements beyond 부루마불's.
- One report: the court acknowledged that place names, landmarks, and the special rules (island / space travel / golden key) of 부루마불 include *many protectable elements*, but held 모두의마블 was not substantially similar to them. The court also noted Netmarble showed an intent to ride on 부루마불's popularity, yet found no unfair-competition violation.
- Unfair competition (catch-all 차목): not established.
- Sources: https://www.gamemeca.com/view.php?gid=1459989 ; https://v.daum.net/v/LB6x2svUMH ; https://www.etnews.com/20171208000238 ; https://www.hhlaw.com.au/kor/insights/view/195 ; https://namu.wiki/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94%20%EC%A0%80%EC%9E%91%EA%B6%8C%20%EB%85%BC%EB%9E%80

**What this means for us:**
1. Genre-level mechanics are free in Korea too (strong support for our approach).
2. The winner *changed the names and art*. We should change even more.
3. "Intent to ride on popularity" language shows a court might be less kind if we imitate specific presentation (e.g., 황금열쇠-style golden-key card art, same city order).
4. Non-hearing dismissal means there is no Supreme Court opinion to cite; the precedential weight is the lower-court reasoning.

### 1.6 Counter-trend: Korean Supreme Court, Farm Heroes Saga (2019)

**대법원 2019. 6. 27. 선고 2017다212095** [V]: King.com (Farm Heroes Saga) v. Avocado Entertainment (Forest Mania). The Supreme Court reversed the dismissal and remanded, holding that a game's **rules, scenario, visuals, music, etc., taken together, can be protectable expression** if the combination shows creative individuality distinct from prior games. It was reported as the first Korean Supreme Court ruling that game rules can be part of protected expression.
- https://www.seoul.co.kr/news/society/2019/07/01/20190701500046
- https://www.newspim.com/news/view/20190701000065
- https://www.etoday.co.kr/news/view/1771479

**Reconciling with 부루마불:** generic genre rules (property trading loop) stay free; a *distinctive combination* (unusual objectives, bonus rules, characters, presentation) can be protected. So our game should have **its own twist and identity**, not "Monopoly rules with new names". This is both the safest legal posture and better product design.

---

## 2. DO NOT USE list

Rule of thumb: if a 4th grader would say "that's Monopoly / 부루마불 / 모두의마블", it is too close. Names below are illustrative, not exhaustive.

### 2.1 Monopoly (Hasbro / Parker Brothers)

| Category | Do not use |
|---|---|
| Word marks / titles | MONOPOLY, any "-poly" coinage (Ghettopoly-style), "Anti-Monopoly", "Monopoly Man"; also avoid "Monopoly" in metadata/keywords/description (see 4.6) |
| Card / space names | **Chance**, **Community Chest** (as card-space names), "Go" (as the start square label), "Free Parking", "Just Visiting", "Go to Jail", "Income Tax", "Luxury Tax", "Get Out of Jail Free" |
| Property names | Mediterranean Avenue, Baltic Avenue, Oriental Avenue, Vermont Avenue, Connecticut Avenue, St. Charles Place, States Avenue, Virginia Avenue, St. James Place, Tennessee Avenue, New York Avenue, Kentucky Avenue, Indiana Avenue, Illinois Avenue, Atlantic Avenue, Ventnor Avenue, Marvin Gardens, Pacific Avenue, North Carolina Avenue, Pennsylvania Avenue, Park Place, Boardwalk [B: standard board list] |
| Transport / utility | Reading Railroad, Pennsylvania Railroad, B&O Railroad, Short Line; Electric Company, Water Works; and the **railroad / light bulb / faucet icon set** |
| Characters | Mr. Monopoly, **Rich Uncle Pennybags**, Ms. Monopoly, any top-hat / monocle / mustache tycoon mascot, the "cop pointing to jail" and "man in striped suit" jail art |
| Tokens | Top hat, Scottie dog, race car, battleship, thimble, boot, wheelbarrow, iron (as a *set*) |
| Layout / trade dress | 40-space square, four corner squares as Go / Jail / Free Parking / Go To Jail in this arrangement; 10 spaces per side with 2-3-3-3-3-3-3-2 color-set pattern in Monopoly's color order; brown / light blue / pink / orange / red / yellow / green / dark blue color bands as a *set in that order*; tinted deed-card layout; pastel money bills in Monopoly's denominations and colors; orange Chance and blue Community Chest card backs, question-mark Chance icon, treasure-chest icon |
| Logo styles | Bold white-on-red / black-outlined MONOPOLY wordmark; red diagonal banner across board center |
| Rules text | Do not copy Hasbro's rulebook wording or example text (rules themselves are free; the prose is not) |

### 2.2 부루마불 / Blue Marble (씨앗사)

| Category | Do not use |
|---|---|
| Marks | 부루마불, 블루마블, Blue Marble, 씨앗사 marks, and phonetic look-alikes (부르마블, 불루마불, 마불 in any title) |
| Special-space names | **황금열쇠** (Golden Key) card name / icon, **무인도** as the jail-equivalent name in *combination* with the others below, **우주여행** (Space Travel), **사회복지기금** (welfare fund) receipt/payment spaces, 출발 as start name with 부루마불-style bonus [names per 부루마불 board description; V via https://ko.wikipedia.org/wiki/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88 and court coverage] |
| Board content | The specific **city list and ordering** (부루마불 ranks cities in GNP order at time of creation and places 서울/부산/도쿄/뉴욕 etc. accordingly; the court coverage lists "place names, landmarks" as protectable in the abstract) [V: https://ko.wikipedia.org/wiki/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88 ; court: https://v.daum.net/v/20161123140506693 and gamemeca link above] |
| Components / naming | 씨앗증서 (deed name), the 29-deed / 30-golden-key-card / 21-hotel / 18-building / 30-villa component counts and their exact naming combination [V: component list via search result on the Korean Wikipedia/Namu pages] |
| Art / UI | The blue-toned classic board art, its character and island/rocket illustrations, box art and logo |
| Series names | 신나는 우주여행, 부루마불 트레이드 (existing sequel titles) |

Note: 무인도 alone was held "common, typical" by the Seoul High Court as a name for a stuck space (V). It is legally low-risk in isolation but **we should still choose our own word** to avoid "combination" arguments. Also, a report says the 부루마불 trademark once lapsed and was registered by another party (BM Korea) [unverified: namu snippet], so trademark status is messy; check KIPRIS rather than assume anything is free.

### 2.3 모두의마블 (Netmarble)

| Category | Do not use |
|---|---|
| Marks | 모두의마블, 모두의 (as a series prefix: Netmarble uses "모두의 ~" branding), 넷마블, 마블 (also collides with Marvel Entertainment), "Modoo Marble", "Everybody's Marble" |
| Feature names used by the game | 세계여행 as a *named special space*, 찬스카드 / 포춘카드 as the *named card types*, and the specific in-game mechanics-with-names such as 랜드마크, 올림픽 space, 월드투어 [names from the reported court comparison (V for 세계여행, 찬스/포춘카드); the 올림픽/랜드마크/월드투어 names are B: confirm in the live game before finalizing] |
| Characters / cosmetics | Any Netmarble character (e.g., Kakao-era 모두의마블 characters), pieces, avatars, UI chrome, sound effects, gacha/"star" economy names |
| Presentation | The saturated 3D-rendered world map with city-blocks, its landmark building models and HUD layout |

**Assessment of "landmark / olympic / world tour" as words** [B, legal reasoning; not a trademark search]:
- As *plain descriptive words*, "landmark", "Olympic", "world tour" are ordinary English/Korean vocabulary and cannot be owned by Netmarble for a board game in the abstract. Using "landmark" in a sentence ("build a landmark on your city") is safe.
- Risk rises when used **as branding**: a named premium building tier called "Landmark", a named tile called "Olympics" with the same doubled-rent behavior, and a "World Tour" travel tile together reproduce the *set* of features in a recognisable arrangement. Also, "Olympic" and the five-rings imagery are separately restricted by the IOC / national Olympic laws (Ted Stevens Olympic and Amateur Sports Act in the US; Korean law also protects Olympic symbols), so **avoid the word "Olympic/Olympics" as a game feature name** in any case.
- Recommendation: use unrelated names ("Grand Plaza" for a top tier, "Festival Day" for a rent-boost event, "Flight Terminal" for travel space) and differentiate mechanics.

---

## 3. SAFE-TO-USE list

### 3.1 Mechanics and structure (free to use; genre conventions)

| Item | Comment |
|---|---|
| Dice movement (1 or 2 dice), doubles rule | Universal |
| Loop / ring board of N tiles | Shape and count are functional (avoid copying tile counts + layout *together with* color art) |
| Buying unowned properties; owner collects rent | Core genre; Landlord's Game (1904) heritage |
| Color / region sets and set-completion bonus | The concept is free; do not reuse Monopoly's colors, order, or 2-3-3-3-3-3-3-2 pattern |
| Building upgrades (levels, "houses" to "hotels") | Free concept; use own names and visuals |
| Mortgage / sell / trade between players | Free |
| Auctions of declined properties | Free (common variant) |
| Jail-like skip space (lose turns / pay to leave) | Free; rename ("Time-Out", "Detour", "Rest Stop") |
| Card-draw spaces with good/bad events | Free; rename and re-theme |
| Tax / fee spaces, start-bonus salary | Free; rename |
| Utility / transport spaces with count-based rent | Free; pick different themes and icons |
| Bankruptcy elimination, last player standing | Free |
| Turn limit / round limit with net-worth scoring | Free |
| Pass-and-play hot-seat on one device | Free |
| Random events, house rules, handicaps | Free |

Support: DaVinci v. ZiKo (US, rules not protectable), 부루마불 v. 모두의마블 (Korea, genre rules "common, typical"), Circular 33. See section 1.

### 3.2 Names, words, and art

- Generic words: property, rent, deed, tile, lot, district, plaza, harbor, market, festival, bank, tax, fee, auction, trade, build, upgrade, tower, bonus, event, roll, turn, round, winner. [B; ordinary vocabulary]
- Korean generic words: 땅, 임대료/통행료, 증서, 구역, 광장, 항구, 시장, 축제, 은행, 세금, 경매, 거래, 건설, 승급, 보너스, 이벤트, 주사위, 차례, 라운드. Avoid 황금열쇠/무인도/우주여행/사회복지기금 as a group.
- **Original fictional cities/landmarks** (recommended): invent an original world (e.g., named districts, invented harbor towns, whimsical landmarks) or use real places only *generically* (see below).
- Real place names: names of real countries, cities and public landmarks are facts and not owned. But (a) a *specific ordered list* copied from 부루마불/모두의마블 is a compilation risk, (b) real landmark *photos or stylized official logos* may carry their own rights (e.g., some buildings' images, sports team/Olympic marks), and (c) real-brand names on tiles (Coca-Cola, Samsung) need permission. Prefer an invented world; if using real cities, pick a different set, different order and your own illustrations.
- **Original art** in your own style, original mascot, original token designs (not top hat / dog / car set), original money design, original card back art, original UI.
- Original sounds and music or CC0 (section 4).

### 3.3 Distinctiveness checklist (design-level, reduces trade-dress and "look-and-feel" risk)

1. Board silhouette not a plain 4-corner square with equal 10-tile sides in Monopoly color order (consider hex/oval/figure-eight, irregular tile widths, 3D isometric perspective).
2. Color sets in our own palette and count (e.g., 6 to 7 regions with different sizes).
3. No cream-colored center with diagonal banner; no orange/blue card back pairing.
4. Own currency (name, symbol, note art). Not "$" bills in pastel set; not "원" 부루마불-style paper money look.
5. Own tokens (originals, e.g., animals or objects with an in-house style).
6. Add at least 2 or 3 signature mechanics that make the game feel different (per section 1.6).
7. Start/corner tile names and art all original.

---

## 4. Asset licensing

### 4.1 Fonts (all are SIL OFL 1.1 unless noted)

| Font | License | Use notes |
|---|---|---|
| **Noto Sans KR** (Google) | SIL OFL 1.1 [B; standard for Noto/Google Fonts] | Full CJK file is large (multi-MB per weight); subset or use variable font to protect APK size |
| **Pretendard** | SIL OFL 1.1, © Kil Hyung-jin, Reserved Font Name "Pretendard" [V] | Good Korean + Latin UI text. https://github.com/orioncactus/pretendard/blob/main/LICENSE |
| **Nunito** | SIL OFL 1.1 [B; Google Fonts] | Rounded Latin; pair with Korean font |
| **Fredoka** | SIL OFL 1.1 [B; Google Fonts] | Rounded, playful Latin display face; **no Hangul** |
| Playful Korean display (optional) | OFL on Google Fonts, e.g., Jua, Do Hyeon, Black Han Sans, Gaegu [B] | Verify each on https://fonts.google.com before bundling |

OFL essentials [V summary via Pretendard/OFL sources]: commercial use, embedding, modification and redistribution are allowed; you may **not sell the font by itself**; keep the copyright + license text with the font files; modified versions must not use the Reserved Font Name; bundling inside an app is fine. Include each OFL text in the licenses screen/`assets/licenses/`.
- https://github.com/orioncactus/pretendard
- https://openfontlicense.org/ [B]
- Caution: some Korean font aggregators (e.g., 눈누 https://noonnu.cc) list many fonts with *non-OFL, custom* licenses; read each license, some ban embedding in apps.

### 4.2 Icons

| Set | License | Attribution/notice duty |
|---|---|---|
| **Tabler Icons** | MIT [V] | Keep MIT copyright notice in your licenses file (visible UI credit not required) |
| **Lucide** | ISC [V] (parts derived from Feather, MIT [B]) | Keep ISC notice (and the Feather MIT notice) in licenses file. https://lucide.dev/license |
| **Phosphor Icons** | MIT [V] | Keep MIT notice |
| **Game-icons.net** | **CC BY 3.0** [V] | **Per-icon author credit required** plus link to https://game-icons.net. The site says "Icons made by {author}. Available on https://game-icons.net"; for a video game, the mention can be reachable from a menu. Credit the *individual author*, not just the site. https://game-icons.net/about.html , https://game-icons.net/faq.html |
| Kenney icon/UI packs | CC0 [V] | None required |
| Material Symbols (Google) | Apache 2.0 [B] | Keep Apache notice |

Comparison source: https://dev.to/svgicons/lucide-vs-tabler-vs-phosphor-which-free-icon-set-fits-your-ui-4ocl and https://dev.to/usapopopooon/what-i-didnt-know-about-icon-library-licenses-and-you-might-not-either-30of

Note on MIT/ISC: the license conditions require including the copyright and permission notice with "copies or substantial portions" of the software; in a compiled app the practical way is a licenses screen. Blog posts saying "no attribution required" mean no *marketing* credit, not no notice.

Avoid: Flaticon/Freepik free tier (attribution + restrictions), Noun Project free tier (attribution), random Pinterest/Google Images art, icons "inspired by" Monopoly items.

### 4.3 Sounds and music

| Source | License | Notes |
|---|---|---|
| **Kenney.nl** audio | CC0 (public domain) [V] | No attribution required; if you choose to credit, "Kenney" or "www.kenney.nl". https://kenney.nl/support |
| **Freesound.org** | Per-sound license: CC0, CC BY, CC BY-NC (and sampling+ for old items) [V] | **Filter to "Creative Commons 0"**; CC0 needs no credit; **exclude every CC BY-NC** (non-commercial only). CC BY requires author credit. Record the sound ID + URL + license in a manifest. https://freesound.org/help/faq/ |
| OpenGameArt.org | Mixed (CC0, CC BY, CC BY-SA, GPL) [B] | Use only CC0 (or CC BY with credit); avoid GPL/CC BY-SA for compiled assets unless counsel approves (share-alike obligations) |
| Original / commissioned | Work-for-hire with written assignment | Best for the theme jingle |

Do not use audio ripped from Monopoly/모두의마블 or from other apps.

### 4.4 Emoji glyphs

| Source | License | OK? |
|---|---|---|
| **Noto Color Emoji** (Google) | Emoji fonts: **SIL OFL 1.1**; tools and most image resources: Apache 2.0; region flags: public domain/exempt [V] https://github.com/googlefonts/noto-emoji | **Yes**, including bundling in an app, with OFL text in licenses |
| **Twemoji** | Code MIT; **graphics CC BY 4.0** [V] https://github.com/twitter/twemoji ; maintained fork https://github.com/jdecked/twemoji | **Yes, with attribution.** The project accepts a mention in an app's Settings/About screen. Include the CC BY 4.0 link and note "Twemoji © Twitter/X and contributors [as applicable], CC BY 4.0" |
| Apple / Samsung / Microsoft emoji | Proprietary | Do not extract or bundle |
| System emoji (rendered by OS font) | Provided by the device | Fine to render, but looks differ per device; **for game-critical tokens use bundled vector art** rather than emoji |

### 4.5 AI-generated or template art [B]

US Copyright Office guidance says purely AI-generated material lacks human authorship and cannot be registered; you would not own exclusive rights and cannot easily prevent copying. Google Play also has AI-generated content rules. Prefer human-authored art; if using generation tools, record prompts, edits and tool terms, and never prompt with "Monopoly-style", "부루마불", or character names.

### 4.6 Google Play requirements relevant to IP and attribution

- **Intellectual Property policy:** apps must not infringe others' IP (trademark, copyright, patent, etc.); developers must ensure all content in the app and store listing is their own original work or properly licensed/permitted. https://support.google.com/googleplay/android-developer/answer/9888072?hl=en [V]
- **Impersonation policy:** do not mislead users about an app's connection to another party's app; prominently featuring another's brand/trademark in title or description can violate policy *even with an "unofficial" disclaimer*. https://support.google.com/googleplay/android-developer/answer/16341334?hl=en [V]. **Do not** write "like Monopoly" / "부루마불 같은" / "모두의마블 대체" in title, short/long description, screenshots, feature graphic, tags or keywords.
- **Overall program policy:** https://support.google.com/googleplay/android-developer/answer/17190352?hl=en
- **Third-party open-source notices:** you are responsible for displaying notices of libraries you ship. Google provides the `oss-licenses-plugin` + `OssLicensesMenuActivity` (from Play services) to auto-generate a license list for **Gradle/Maven dependencies**. https://developers.google.com/android/guides/opensource [V]. GNU-family (GPL/LGPL/AGPL) libraries in a closed app are generally a problem (https://medium.com/@timetools/what-common-licence-types-are-allowed-in-an-android-app-f27b1423bf01 [V summary]); avoid them.
- **Recommended in-app implementation:**
  1. Settings > "Credits & Licenses" screen reachable in <=2 taps (also mention in the store listing's "About" text if you like).
  2. Section A: auto-generated dependency licenses (oss-licenses-plugin or AboutLibraries).
  3. Section B: hand-maintained **assets manifest** (font, icons, sounds, emoji): name, author, source URL, license, license text link/body. Ship the full texts of OFL, MIT, ISC, Apache-2.0, CC BY 3.0/4.0 in `assets/`.
  4. Keep a repo file `docs/ASSET_LICENSES.md` mirroring the manifest so future contributors follow the same rule.
  5. CI check idea: fail the build if a new asset file has no manifest entry.
- Provide the developer contact and a takedown path in the store listing; Play may act on rights-holder notices.

---

## 5. Naming

### 5.1 Ground rules for the title

- Must not contain or sound like: MONOPOLY / -POLY, 부루마불 / 블루마블 / 마블 / Marble, 모두의 ~, Marvel.
- Avoid famous game/brand fragments ("Crossing" (Animal Crossing), "Royale", "Kings" (Board Kings), "Tycoon" alone (generic and crowded), "GO!" (Monopoly GO!), "Dice City/Dice Throne" (registered).
- Prefer a coined or pun-based compound; add a Korean transliteration; keep the English title <=30 characters for Play.
- Check: Google Play search, App Store, Steam, KIPRIS (classes 9, 28, 41), USPTO (same classes), EUIPO, domain, social handles.

### 5.2 Ten candidates

Search screens were run on Google Play/web via search engine; "No exact hit" means no exact-name result appeared, **not** that the name is clear.

| # | English | Korean | Idea | Screen result / risk |
|---|---|---|---|---|
| 1 | **Lot & Roll** | **랏앤롤** | "lot" = plot of land, "roll" = dice; echoes "rock and roll" | No exact hit for "Lot & Roll"/"Lot and Roll"; only generic "Roll ..." apps appear (Roll Player, Roll For It!, Let's Roll!). Low apparent risk; check "Roll" + board/dice class 9/28 marks |
| 2 | **Toll Town** | **톨타운** | rent as tolls in a small town | No exact hit; only toll-booth sims (Toll Booth Simulator, Super Toller Tycoon). Low; "Town" is crowded, so add logo distinctiveness |
| 3 | **Rooftop Rally** | **루프탑 랠리** | roof-hopping city loop | No exact hit for the title; unrelated parkour game "Rooftops & Alleys". Low to medium (alliteration is common; check class 9) |
| 4 | **Townbound** | **타운바운드** | heading around town | No exact hit; near-neighbors "Citybound: City Tycoon", "Township" (Playrix, famous). Medium risk of confusion with Township/Citybound |
| 5 | **Plot Party** | **플롯 파티** | plots of land + party game | No exact hit; but "Plot" (kids' stories developer) and generic "Party Games" apps. Medium (generic "Party") |
| 6 | **Dice District** | **다이스 디스트릭트** | dice + city district | No exact hit for the phrase; many DICE-prefixed marks (DICE CITY registered for board/card games; Dice Throne). Medium; the shared "DICE + noun" pattern is risky |
| 7 | **Lucky Lots** | **럭키 랏츠** | luck + land lots | No exact hit; but very crowded "Lucky ..." namespace (lottery/casino-adjacent), which could also draw a gambling-content misread. Medium |
| 8 | **Homestead Hop** | **홈스테드 합** | hopping around homesteads | No exact hit found. Unverified; low to medium |
| 9 | **Alley Lords** | **골목대장** | 골목대장 = Korean idiom for the "boss of the neighborhood alley" | No exact hit for "Alley Lords"; 골목대장 is a common Korean word/idiom (likely used by others, e.g., books, shows). Medium for Korean; needs KIPRIS |
| 10 | **Round & Round Town** | **빙글빙글 타운** | circling around town | Not searched in depth; onomatopoeic Korean word "빙글빙글" is extremely common in kids' content. Medium (weak distinctiveness) |

Additional flags found in screening: **Roll Machine** (city-building/puzzle) and **Let's Roll!** (board-style roguelike) exist on stores; property-trading competitors include Monopoly GO!, Board Kings, Business Tour, Rento, Richup.io, 주사위의 신 (Joycity). Names starting "Business", "Rich", "Board" are crowded.
- https://play.google.com/store/apps/details?id=com.scopely.monopolygo&hl=en
- https://play.google.com/store/apps/details/Board_Kings_%D0%BD%D0%B0%D1%81%D1%82%D0%BE%D0%BB%D1%8C%D0%BD%D1%8B%D0%B5_%D0%B8%D0%B3%D1%80%D1%8B?id=com.jellybtn.boardkings&hl=en_US
- https://play.google.com/store/apps/details?id=com.joycity.god&hl=en_US
- https://store.steampowered.com/app/397900/Business_Tour__Board_Game_with_Online_Multiplayer/
- https://apps.apple.com/us/app/rento-online-dice-board-game/id1231737310
- https://trademarks.justia.com/882/02/dice-88202787.html (DICE CITY)

### 5.3 Recommendation

**Primary: Lot & Roll / 랏앤롤.**
- Describes the core loop (land + dice) without using any "-poly/-marble" fragment.
- Pun is memorable; short; pronounceable in Korean and English; logo-friendly ("&" glyph as a dice pip or house).
- No exact-name collision surfaced in screening.
- Backup: **Toll Town / 톨타운**, then **Rooftop Rally**.

**Before committing:**
1. Run formal searches (KIPRIS, USPTO, EUIPO; Play, App Store, Steam) for "Lot & Roll", "LotNRoll", "Lot n Roll", "랏앤롤", "롯앤롤" (phonetic variants).
2. Check that "Roll"-formative registrations in Nice classes 9, 28, 41 don't create a conflict.
3. Register the domain/handles; consider filing a KR + US trademark application once cleared.
4. Keep the store description free of competitor names (see 4.6).

---

## 6. Open items and verification to-do

| # | Item | Why | Suggested action |
|---|---|---|---|
| 1 | Confirm current letter of the Korean catch-all unfair-competition clause (차/카/파목) | Sources conflict on renumbering | Read law.go.kr text |
| 2 | Read full Korean opinions (2016가합570805; Seoul High Court appeal; date of Supreme Court dismissal) | Only news summaries were accessible | Download from CaseNote/대법원 종합법률정보 |
| 3 | Verify Modu Marble special-space and card names in the live game (올림픽, 랜드마크, 월드투어) | Names were not confirmed from primary sources | Play the game; screenshot; add to "avoid" list |
| 4 | Check USPTO records for Hasbro registrations (CHANCE, COMMUNITY CHEST, board design, tokens) | Currently based on Hasbro notice and commentary | USPTO trademark search |
| 5 | Check KIPRIS for 부루마불, 블루마블, 황금열쇠, 모두의마블 registrations and owners | Reports of lapse/re-registration by another party | KIPRIS search |
| 6 | Clear final title (section 5.3) | Screens here are not clearance | Attorney-run search |
| 7 | Confirm licenses for every font/icon/sound at time of download (license can change) | Licenses are per-file | Store LICENSE files + URLs + date in repo |
| 8 | Decide on real vs invented city names | Compilation and third-party image risk | Design decision; prefer invented |

---

## 7. Source index

**US law and cases**
- https://www.copyright.gov/circs/circ33.pdf
- https://www.copyright.gov/register/tx-games.html
- https://www.courtlistener.com/opinion/8715588/tetris-holding-llc-v-xio-interactive-inc/
- https://en.wikipedia.org/wiki/Tetris_Holding,_LLC_v._Xio_Interactive,_Inc.
- https://www.loeb.com/en/insights/publications/2012/06/tetris-holding-llc-v-xio-interactive-inc
- https://law.justia.com/cases/federal/district-courts/texas/txsdce/4:2013cv03415/1134359/73/
- https://www.govinfo.gov/app/details/USCOURTS-txsd-4_13-cv-03415
- https://www.gamedeveloper.com/business/texas-court-affirms-game-mechanics-not-protected-under-copyright-law
- https://law.justia.com/cases/federal/appellate-courts/F2/684/1316/40646/
- https://law.justia.com/cases/federal/appellate-courts/F2/611/296/276886/
- https://www.quimbee.com/cases/anti-monopoly-inc-v-general-mills-fun-group-inc
- https://en.wikipedia.org/wiki/History_of_Monopoly
- https://en.wikipedia.org/wiki/Ghettopoly
- https://grr.com/publications/monopoly-trademark-hasbros-monopoly/
- https://www.americanbar.org/groups/intellectual_property_law/resources/landslide/archive/not-playing-around-board-games-intellectual-property-law/
- https://www.mondaq.com/unitedstates/trademark/1433628/trademark-protection-for-board-games-unlock-the-potential-of-trade-dress-for-your-board-game
- https://ilr.law.uiowa.edu/sites/ilr.law.uiowa.edu/files/2022-11/Intellectual%20Property%20and%20Tabletop%20Games.pdf
- https://scholarlycommons.law.wlu.edu/cgi/viewcontent.cgi?article=1734&context=wlufac
- https://instructions.hasbro.com/en-us/instruction/monopoly-go
- https://apps.apple.com/us/app/monopoly-the-board-game/id1477966166
- https://en.wikipedia.org/wiki/Mr._Monopoly

**Korean law and cases**
- https://www.law.go.kr/lsInfoP.do?lsId=000308&ancYnChk=0
- https://www.kimchang.com/ko/insights/detail.kc?sch_section=4&idx=21357
- https://www.lawtimes.co.kr/news/articleView.html?idxno=163707
- https://v.daum.net/v/20161123140506693
- https://casenote.kr/%EC%84%9C%EC%9A%B8%EC%A4%91%EC%95%99%EC%A7%80%EB%B0%A9%EB%B2%95%EC%9B%90/2016%EA%B0%80%ED%95%A9570805
- https://www.etoday.co.kr/news/view/1618440
- https://zdnet.co.kr/view/?no=20180430094103
- https://news.mtn.co.kr/news-detail/2018091913574246160
- https://www.gamemeca.com/view.php?gid=1459989
- https://v.daum.net/v/LB6x2svUMH
- https://www.etnews.com/20171208000238
- https://www.hhlaw.com.au/kor/insights/view/195
- https://namu.wiki/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94%20%EC%A0%80%EC%9E%91%EA%B6%8C%20%EB%85%BC%EB%9E%80
- https://ko.wikipedia.org/wiki/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88
- https://www.bluemarble1982.com/boardgame
- https://www.seoul.co.kr/news/society/2019/07/01/20190701500046
- https://www.newspim.com/news/view/20190701000065
- https://www.etoday.co.kr/news/view/1771479
- https://www.nepla.net/post/%EB%B3%B4%EB%93%9C%EA%B2%8C%EC%9E%84%EA%B3%BC-%EC%A0%80%EC%9E%91%EA%B6%8C
- https://www.kipris.or.kr/

**Asset licensing**
- https://github.com/orioncactus/pretendard/blob/main/LICENSE
- https://github.com/googlefonts/noto-emoji
- https://github.com/twitter/twemoji and https://github.com/jdecked/twemoji
- https://lucide.dev/license
- https://game-icons.net/about.html and https://game-icons.net/faq.html
- https://kenney.nl/support
- https://freesound.org/help/faq/
- https://dev.to/svgicons/lucide-vs-tabler-vs-phosphor-which-free-icon-set-fits-your-ui-4ocl
- https://dev.to/usapopopooon/what-i-didnt-know-about-icon-library-licenses-and-you-might-not-either-30of
- https://noonnu.cc/en/font_page/694

**Google Play**
- https://support.google.com/googleplay/android-developer/answer/9888072?hl=en
- https://support.google.com/googleplay/android-developer/answer/16341334?hl=en
- https://support.google.com/googleplay/android-developer/answer/17190352?hl=en
- https://developers.google.com/android/guides/opensource
- https://medium.com/@timetools/what-common-licence-types-are-allowed-in-an-android-app-f27b1423bf01
