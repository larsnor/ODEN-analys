# Nödvändiga förberedelser för ODEN

## 1. Signal — rapporteringskanalerna

- **Dedikerat nummer för ODEN.** Oden (intagsappen) länkas till ett eget
  telefonnummer/konto — aldrig en operatörs privata. Länkningen kräver telefonen
  på plats och internet (QR-kod) — gör det i förväg.
- **Grupp(erna) skapas uppifrån.** En person i kompaniledningen skapar
  Signal-grupp(er) (t.ex. en per pluton/sektor) och bjuder in plutoncheferna;
  plutoncheferna bjuder i sin tur in sina soldater. Odens nummer läggs till i
  varje grupp intaget ska lyssna på; vitlistning i Odens konfiguration om bara
  vissa avsändare eller grupper ska tas emot. Minimum (och enklast) är en signal grupp, 
  för all rapportering där samtliga är medlemmar.
- **Tydliga instruktioner för hur Signal-trafiken hanteras**, skriftligt och
  utdelat:
  - Endast meddelanden som börjar med `7S RAPPORT` blir rapporter — allt annat
    (frågor, kvittenser, prat) ignoreras av intaget och hör hemma i en annan
    grupp/tråd.
  - TNR = tidpunkt DDHHMM (dag, timme, minut) — samma format i Stund.
  - Sagesman = anropssignal, inte namn.
  - Foton bifogas i SAMMA meddelande som rapporten (ett foto per rapport
    räcker; kvalitet före kvantitet).
  - En observation = ett meddelande. Rätta fel med ett nytt meddelande, inte
    genom att redigera.
  **Kanalen för rapportering enkelriktad**, dvs endast 7S meddelanden in från 
  rapportörer till ODEN, inga frågor, inga omsändning, inget annat. 

## 2. På soldatnivå (varje rapportör)

- Installera **Signal** på telefonen; verifiera att numret fungerar. 
- Saknas mobilnummer på telefonen, knyts enklast telefonen till individens 
  eget Signal konto med hjälp av QR-kod
- **Medlemskap i rätt Signal-grupp(er)** — kontrollera i förväg att alla
  rapportörer syns i gruppen och att Odens nummer finns med.
- Öppna **7srapport.com** — webbsidan som säkerställer 7S-formatet (fälten
  TNR, Stund, Ställe, Händelse, Symbol, Sagesman, Sedan) och producerar ett
  färdigt meddelande att klistra in i Signal.
- **Spara sidan som genväg på telefonens hemskärm** (Safari: Dela → *Lägg till
  på hemskärmen*; Android/Chrome: ⋮ → *Lägg till på startskärmen*) för snabb
  åtkomst i fält.


## 3. På Ledningsplatsen

- **Dator på plats**  ODEN-valvet (⚙ enradsinstallationen — operativ variant), 
Obsidian, Oden.app. Strömförsörjning och laddare — analysen är strömkrävande med lokal AI.
- **Internetåtkomst på ledningsplatsen**: krävs för Signal-intaget (Oden tar
  emot via Signals servrar) och för kartrutor som inte redan är hämtade.
  Mobilt bredband/delad telefon räcker; bandbredden är låg (text + foton).
- **Gjort i förväg, med internet:** modellerna hämtade (`ollama pull
  qwen3-vl:4b` + `qwen3:8b`/`qwen3:32b`), CARTO-kartnyckeln inlagd, Oden länkad
  och konfigurerad (rapporter till `inkorg/`), operationsområdet satt,
  **namngivna platser** (grindar, förråd, infarter — med radie, skyddsvärda
  markerade) inlagda, kartan förhämtad över operationsområdet.
- **Genomkörning**: en kort övning med en demokassett (övningsvalvet) eller
  provmeddelanden från fält — M1–M8 (text, plåt, foto, flagga, bevakning,
  analys) innan skarp start.
- **Säkerhetskopia** av valvet (och `~/.oden`) tagen; vet hur "Nollställ
  valvet" fungerar och att det är oåterkalleligt utan kopia.

## 4. Om internetåtkomsten faller bort

- **Fungerar utan internet:** hela ODEN-analysen — flöde, larm, aktörer,
  graf, bildanalys, textanalys, chatt och djupanalys (allt lokalt via
  Ollama); kartan över redan visade/förhämtade rutor; alla rapporter som
  redan tagits emot.
- **Fungerar inte:** nya Signal-meddelanden når inte Oden (intaget står
  stilla tills nätet är tillbaka — meddelandena köas i Signal och levereras
  då); kartrutor utanför det förhämtade området.
- **Reservrutin — traditionella sambandsmedel:** rapporterna lämnas via
  **Ra 180** (röst) eller via **MC-ordonnans**, och operatören matar in dem
  manuellt med **＋ Obs** i ODEN-panelen (samma 7S-fält, samma TNR-disciplin)
  eller som `TNR<DDHHMM>.md` i `inkorg/`;  Analysen fortsätter som vanligt — ODEN analyserar
  valvet, inte Signal — och när nätet är tillbaka fyller Signal-kön på utan
  dubbletter (manuellt inmatade rapporter får sina egna TNR).
- Förbered: kartan förhämtad i förväg (Map View: *cache all tiles* över
  området), reservström, radiosambandet (Ra 180-passning) och en utpekad
  person som ansvarar för den manuella inmatningen.
