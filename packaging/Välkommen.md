# Välkommen till ODEN

Det här valvet är färdigt att använda: ODEN-panelen nere till höger, kartan och
grafen överst. Analysen körs helt på din egen dator – det enda som behöver nätet
är kartbakgrunden. ODEN läser de 7S-rapporter som
landar i mappen `inkorg/`, känner igen fordon och kännetecken som återkommer,
poängsätter misstänkt aktivitet och larmar när något händer. Grundregeln genom
hela systemet är enkel: **ODEN föreslår – du avgör.** Ingen koppling skapas utan
att du bekräftat den, och varje bedömning går att granska i efterhand.

## Kom igång

Det första man gör är att tala om för ODEN vad som ska bevakas. Tryck
`Cmd/Ctrl-P` och kör kommandot **"ODEN: Konfigurera operationsområde"** – ange
koordinaten (`lat,lon` eller en MGRS-ruta) så centreras kartan dit och
🎯 Objektet dyker upp.

Passa sedan på att namnge de platser du redan känner till: grindar, förråd,
infarter. Det gör du i panelens `⋯`-meny under **"Namngivna platser…"**. Markerar
du en plats som **skyddsvärd** larmar ODEN vid aktivitet i närheten – praktiskt
för det där förrådet som ligger lite avsides. Ett tips: högerklicka i kartan och
välj *"Copy geolocation as front matter"*, så kan positionen klistras rakt in i
formuläret.

En sak till innan du sätter igång: **kartnyckeln**. Kartrutorna kommer från
CartoDB, som kräver en egen nyckel. Hämta en gratis på
[carto.com/basemaps/apikey](https://carto.com/basemaps/apikey) – en minut, inget
konto behövs – och klistra in den i **Settings → Map View**, sist i CartoDB-
källans adress så att den slutar med `?key=DIN_NYCKEL`. Utan nyckel fungerar
kartan ändå, men rutorna får texten *"API key required"*; vill du slippa den
byter du kartkälla till **OpenStreetMap (ingen nyckel)**, som redan ligger i
valvet.

Panelen är enkel att hitta i. Överst sitter temaknappen (🌙/☀︎), `＋ Obs` för att
skriva en egen observation, och `⋯`-menyn. Raden med **📷 Bild · 📝 Text ·
💬 Chat** slår på de valfria AI-förmågorna (kräver Ollama, mer om det nedan) –
utan dem arbetar ODEN helt deterministiskt, vilket räcker långt. I flödet
**Händelser & larm** dyker allt nytt upp; klickar man på en förslagsrad (🔗, 🎒,
📷 eller 📝) öppnas granskningen där du bekräftar eller avvisar fynden, och när
inget återstår hamnar du tillbaka i flödet. Längst ner finns frågelådan – prova
*"vilka larm har vi?"* eller skriv in en regplåt.

Två handgrepp till är bra att kunna. Ser du en rapport som analysen borde ha
reagerat på – högerklicka på den och välj **"ODEN: Flagga som larm"**, så larmas
den med skälet *flaggad av operatör*. Och vill du hålla extra koll på något –
en rapport, ett fordon, en aktör eller ett kännetecken – väljer du
**"ODEN: Bevaka"**. Då hamnar den i 🔭 **Bevakningslistan** överst i panelen, och
ny aktivitet markeras med *+N nya* tills du tittat. Bevakningen påverkar aldrig
misstankepoängen – den styr bara vad du ser.

## Testa med demodata

I mappen `demo/` ligger en syntetisk övningskorpus: fjorton dygn kring HvSS
Vällinge med knappt 350 rapporter (en del med foton), en dold spaningscell och
en demonstration. Inga riktiga personer eller fordon förekommer.

Sätt operationsområdet till demokoordinaten `59.2622,17.712`. Kör sedan
kommandot **"ODEN: Mata demodata"** (finns även i `⋯`-menyn), välj hur lång tid
uppspelningen ska ta – 15 minuter är lagom första gången – och luta dig
tillbaka. Rapporterna droppar in i korpusens egen rytm: lugna nätter är lugna,
och när spaningscellen rör sig blir det plötsligt bråttom. Granska förslagen,
flagga, bevaka och fråga i chatten medan det pågår; samma kommando pausar och
återupptar. Kör du Ollama kan du slå på 📷-chipet – då ser du *"Bild mottagen,
analys startad"* följt av bildfynd att granska när fotorapporterna kommer.

Vill man hellre mata för hand går det förstås också: dra innehållet i
`demo/batch-01` till `inkorg/` (i Obsidians filpanel eller i Finder), och
fortsätt batch för batch.

När du är klar visar `demo/facit.json` hur det faktiskt låg till – jämför gärna
med vad du själv hittade. Vill du börja om kör du *"Konfigurera
operationsområde"* igen med en ny koordinat (alla beslut rensas, du varnas
först) och tömmer `inkorg/`.

Vill du generera egna korpusar, med andra platser och hotbilder, finns
verktyget [7S-generator](https://github.com/larsnor/7S-generator).

## Skarp drift

Får förbandet rapporterna via **Signal**? Installera intagsappen
[Oden](https://github.com/NicklasAndersson/oden) — den lyssnar på er
Signal-grupp och skriver varje `7S RAPPORT`-meddelande som en färdig rapportfil
här i valvet, som ODEN analyserar direkt. Viktigt i dess setup-wizard: peka
vault-sökvägen på den här mappen och **hoppa över Obsidian-mallsteget** (valvet
är redan komplett). Rapporterna hamnar i en mapp med Signal-gruppens namn — det
går lika bra som `inkorg/`.


Radera mappen `demo/` och eventuellt övningsinnehåll i `inkorg/`. Sätt ditt
riktiga operationsområde och namnge platserna i förväg. Sedan är det bara att
låta intaget leverera 7S-rapporter till `inkorg/` – ODEN plockar upp dem
automatiskt.

## Ollama – valfri AI-förstärkning

ODENs kärna är deterministisk och fungerar helt utan AI. Men med en lokal
språkmodell får systemet extra räckvidd: **📷 Bild** läser foton
(registreringsskyltar, fordon, personer), **📝 Text** hittar kännetecken och
beteenden i fritexten som de fasta ordlistorna missar, och **💬 Chat** låter dig
fråga med naturligt språk. Allt körs lokalt på din egen dator – inget skickas
någonstans. Och som i resten av ODEN gäller samma regel: modellen föreslår
bara, du bekräftar varje fynd.

Så här kommer du igång: installera [Ollama](https://ollama.com) (gratis, finns
för macOS, Windows och Linux), kör `ollama pull qwen3-vl:4b` i en terminal
(cirka 3 GB, laddas ned en gång), och tryck **"Testa anslutning"** under
**Inställningar → ODEN**. Slå sedan på chipsen i panelen.

## Mer

Fler installationsvägar och felsökning finns i `INSTALL.md` (i releasen och på
[GitHub](https://github.com/larsnor/ODEN-analys)). Fyra korta skärmfilmer
(30–45 s, utan ljud) som visar installation, uppsättning, flödet och
operatörens verktyg finns på GitHub-sidan och på senaste releasen. Den här
noten kan du radera när den har gjort sitt.
