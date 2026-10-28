# Garmin Personal MCP

Serwer MCP w JavaScript (Node.js 24+) do analizy biegania, kolarstwa, pływania, treningu siłowego, snu i regeneracji. Korzysta z oficjalnego Garmin Connect **Personal API**, przeznaczonego do danych jednego użytkownika.

Serwer zwraca dane, powtarzalne obliczenia i propozycje planów. ChatGPT lub Claude interpretuje wyniki w rozmowie. Nie potrzebujesz osobnego klucza do modelu AI.

## Instalacja pluginu

Projekt udostępnia dwa lokalne pluginy:

- **Claude Desktop** — instalowalny plik `.mcpb`; formularz pyta tylko o klucz Garmin. Region, strefa czasowa i katalog danych są ustawiane automatycznie.
- **ChatGPT Work / Codex** — plugin z lokalnego marketplace. Korzysta z `.env` i bazy w katalogu projektu; udostępnia też skill `$garmin-report` do raportów i lokalnych scheduled tasks.

Przejdź do [instalacji w Claude Desktop](#claude-desktop--instalowalne-rozszerzenie-z-formularzem) lub [instalacji w ChatGPT Work / Codex](#lokalny-plugin-dla-chatgpt-work--codex-i-scheduled-tasks). Oba warianty działają lokalnie przez stdio, bez serwera HTTPS i OAuth.

## Uruchomienie serwera i konfiguracja `.env`

Ta konfiguracja jest potrzebna dla pluginu ChatGPT Work / Codex, ręcznego podłączenia MCP i serwera HTTP. Rozszerzenie Claude Desktop zbiera klucz we własnym formularzu.

```sh
npm ci
npm run setup
npm run verify:garmin
npm start
```

`setup` przyjmuje klucz w ukrytym polu terminala, zapisuje lokalny `.env` z uprawnieniami `600` i generuje osobny token dostępu do transportu HTTP. Jeśli `.env` jest już skonfigurowany, pomiń `setup`. Plik `.env` i katalog `data/` są wykluczone z Git i obrazu Docker.

`npm start` uruchamia **stdio**: proces oczekuje na komunikaty MCP, a nie komendy wpisywane przez człowieka. Komunikaty diagnostyczne trafiają wyłącznie na stderr. `.env` jest odczytywany względem katalogu projektu, niezależnie od katalogu roboczego klienta.

Weryfikacja połączenia nie wyświetla danych zdrowotnych, kluczy ani tokenów. Sprawdza wymianę tokena, listę aktywności i dostępność dziennego podsumowania, snu oraz HRV. Brak pomiaru danego dnia może być normalny.

### Bez konta Garmin

```sh
npm run demo
# lub transport HTTP na 127.0.0.1:3000/mcp
npm run demo:http
```

Demo generuje syntetyczną historię 120 dni, jawnie oznacza wszystkie wyniki i używa osobnej bazy `data/demo/state.sqlite`. Nigdy nie zastępuje niedostępnych danych prawdziwego konta danymi demonstracyjnymi. Jeżeli w `.env` jest token HTTP, wymagany jest również w demo.

## Dodanie do ChatGPT i Claude — wybór sposobu

| Klient | Sposób połączenia | Co przygotować |
| --- | --- | --- |
| Claude Desktop — rozszerzenie | Plik `.mcpb`, lokalne stdio | Zbudowana paczka i klucz Garmin w formularzu; runtime Node 24+ w aplikacji |
| ChatGPT Work / Codex na tym komputerze | Plugin z lokalnego marketplace, stdio | Node 24+, repozytorium, zależności i `.env` |
| Claude Desktop — konfiguracja ręczna | Lokalny proces stdio | Node 24+, `.env` i wpis w konfiguracji aplikacji |
| ChatGPT w przeglądarce | Zdalny Streamable HTTP | Serwer HTTPS, OAuth i dodanie własnego pluginu MCP |
| Claude w przeglądarce, Desktop lub na telefonie — zdalny connector | Zdalny Streamable HTTP | Serwer HTTPS, OAuth i dodanie custom connectora |

W Claude Desktop najprościej zainstalować plik `.mcpb`. Lokalny plugin ChatGPT Work / Codex instaluje się z wygenerowanego marketplace. Zdalny wariant pozwala korzystać z tego samego serwera i tej samej bazy planów w obu produktach. Przykładowa domena `garmin.example.com` poniżej jest miejscem na Twój adres, a nie działającą usługą.

## Claude Desktop — instalowalne rozszerzenie z formularzem

```sh
npm ci
npm run plugin:build:claude
```

Gotowy plik: `dist/garmin-0.1.0.mcpb`. W Claude Desktop wybierz **Settings → Desktop app → Extensions → Manage → Advanced settings → Install Extension…** i otwórz paczkę. W starszym interfejsie zacznij od **Settings → Extensions**.

Formularz pyta wyłącznie o klucz `GARMIN_API_KEY`, przechowywany jako sekret. Region jest automatycznie ustawiony na `com`, strefa czasowa pochodzi z systemu, a dane trafiają do `~/.garmin-personal-mcp/data`, poza katalogiem instalacji. Nie trzeba tworzyć `.env` ani wybierać katalogów.

Paczka zawiera kod i zależności produkcyjne, bez `.env`, sekretów i bazy. Nie wymaga zachowania repozytorium. Wymaga runtime Node 24+ w Claude Desktop. Szczegóły: [instrukcja rozszerzenia](plugins/claude-desktop/README.md). Po instalacji poproś Claude o `server_status` i sprawdź tryb `GARMIN`.

Źródło: [oficjalna instrukcja rozszerzeń Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## Lokalny plugin dla ChatGPT Work / Codex i scheduled tasks

Na komputerze z tym repozytorium możesz zainstalować osobisty plugin **Garmin** bez hostingu i OAuth. Aplikacja uruchamia MCP przez stdio. Plugin korzysta z `.env`, zależności i bazy danych w tym katalogu; jego kopia instalacyjna nie zawiera kluczy ani pomiarów.

```sh
npm ci
npm run setup
npm run verify:garmin
npm run plugin:build
codex plugin marketplace add "$(pwd)/dist/garmin-marketplace"
codex plugin add garmin@garmin-local
```

Jeśli `.env` jest już skonfigurowany, pomiń `npm run setup`. W odróżnieniu od rozszerzenia Claude Desktop ten plugin odczytuje klucz z `.env` w repozytorium.

Jeśli dana wersja CLI nie obsługuje `plugin add`, po dodaniu marketplace otwórz Plugins w aplikacji desktopowej, wybierz źródło **Garmin — lokalne pluginy** i zainstaluj **Garmin**. Odśwież widok pluginów lub uruchom ponownie aplikację, jeśli źródło jeszcze się nie pojawiło.

W nowym lokalnym czacie wybierz plugin Garmin i poproś: „Wywołaj `server_status`, potem podsumuj moją regenerację z dzisiaj”. Oczekiwany tryb to `GARMIN`; dane demo mają oznaczenie `DEMO_SYNTHETIC_DATA`.

Plugin udostępnia też skill `$garmin-report`. Przykładowy prompt scheduled task:

> Użyj pluginu Garmin i skilla $garmin-report. Przygotuj poranny raport dzisiejszej regeneracji oraz propozycję treningu. Oblicz datę dla bieżącego uruchomienia w strefie czasowej serwera. Pisz krótko po polsku i pokaż braki lub niepełną synchronizację. Odczytuj dane bez zmiany planu treningowego.

Najpierw sprawdź prompt w zwykłej rozmowie. Następnie poproś w aplikacji o uruchamianie go o wybranej godzinie jako **lokalny** scheduled task, z dostępnym pluginem Garmin. Komputer musi być włączony i aktywny, a aplikacja uruchomiona. Ta instrukcja ani `plugin:build` nie tworzą harmonogramu.

Pakiet w `dist/garmin-marketplace` jest powiązany z pełną ścieżką tego checkoutu i rzeczywistego pliku Node. Zachowaj ten katalog marketplace oraz repozytorium. Po przeniesieniu projektu lub zmianie Node wygeneruj pakiet ponownie i odśwież instalację pluginu. Plugin jest przeznaczony do lokalnego wykonania w aplikacji desktopowej; uruchomienie w chmurze wymaga wariantu HTTP opisanego w sekcji o zdalnym serwerze.

Źródła: [pakowanie i instalacja lokalnych pluginów](https://developers.openai.com/plugins/build/plugins), [lokalne MCP przez stdio](https://developers.openai.com/plugins/deploy/desktop-only), [scheduled tasks i pluginy](https://learn.chatgpt.com/docs/automations).

### Konfiguracja i przechowywanie danych obu pluginów

| Ustawienie | Claude Desktop (`.mcpb`) | ChatGPT Work / Codex (marketplace) |
| --- | --- | --- |
| Klucz Garmin | Pole sekretu w formularzu rozszerzenia | `GARMIN_API_KEY` w lokalnym `.env` |
| Region | Automatycznie `com` | `GARMIN_REGION` z `.env`, domyślnie `com` |
| Strefa czasowa | Wykrywana z systemu | `TIME_ZONE` z `.env`, domyślnie `Europe/Warsaw` |
| Dane i tokeny | `~/.garmin-personal-mcp/data` | `DATA_DIR` z `.env`, domyślnie `data/` w projekcie |
| Zależności | Zawarte w `.mcpb` | Zainstalowane przez `npm ci` w projekcie |
| Po przeniesieniu repozytorium | Zainstalowane rozszerzenie działa samodzielnie | Ponownie zbuduj marketplace i odśwież instalację |

Oba pluginy korzystają z tego samego API Garmin, ale domyślnie przechowują osobne lokalne plany, propozycje i dziennik samopoczucia. Aktualizacja paczki Claude zachowuje dane poza katalogiem instalacji. Gotowe artefakty powstają w `dist/`, wykluczonym z Git; po pobraniu repozytorium zbuduj wybrany wariant odpowiednim poleceniem.

## Claude Desktop — ręczna konfiguracja lokalna krok po kroku

1. W terminalu przejdź do projektu i sprawdź wymagania:

   ```sh
   cd /ABSOLUTE/PATH/TO/garmin-mcp
   node --version
   npm ci
   npm run verify:garmin
   ```

   Potrzebny jest Node 24+. Jeśli nie masz jeszcze lokalnego `.env`, najpierw uruchom `npm run setup`.

2. Wygeneruj konfigurację z poprawną, pełną ścieżką do Node:

   ```sh
   npm run --silent config:claude
   ```

3. W Claude Desktop otwórz ustawienia aplikacji, **Developer → Edit Config**. W nowszym układzie ustawień status lokalnych serwerów jest także w **Desktop app → Extensions → Manage → Local MCP servers**. Jeśli konfigurację otwierasz ręcznie, na macOS użyj `~/Library/Application Support/Claude/claude_desktop_config.json`.

4. Dodaj wygenerowany wpis `garmin` do istniejącego obiektu `mcpServers`. Zachowaj pozostałe serwery; nie doklejaj drugiego głównego obiektu JSON. Jeśli plik jest pusty, wklej cały wynik skryptu.

Przykładowa struktura (skrypt z kroku 2 podaje rzeczywistą ścieżkę Node):

Dodaj do `mcpServers` w konfiguracji Claude Desktop (na macOS `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/garmin-mcp/src/index.js"]
    }
  }
}
```

5. Zapisz plik i całkowicie zamknij Claude Desktop, a następnie uruchom go ponownie. Claude sam uruchomi proces MCP — nie musisz osobno zostawiać `npm start` w terminalu.

6. W nowej rozmowie otwórz **+ → Connectors** i sprawdź narzędzia `garmin`. Poproś: „Użyj Garmin i wywołaj `server_status`”. Powinien zgłosić tryb `GARMIN`; serwer udostępnia obecnie 19 narzędzi.

7. Następnie sprawdź realną analizę: „Użyj Garmin i podsumuj moją regenerację z dzisiaj”.

Klucz Garmin pozostaje w `.env`; nie umieszczaj go w JSON konfiguracji Claude. Do demo dopisz `"--demo"` do `args`. Skrypt rozwiązuje tymczasowe symlinki menedżera wersji Node. Po usunięciu lub zmianie wersji Node wygeneruj konfigurację ponownie.

[Oficjalna instrukcja lokalnego MCP](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [ustawienia i logi Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## Przygotowanie zdalnego serwera dla ChatGPT i Claude

```sh
npm run start:http
```

Endpoint: `http://127.0.0.1:3000/mcp`. Lokalny transport wymaga `Authorization: Bearer <MCP_ACCESS_TOKEN>` poza lokalnym demo bez tokena. To **inny sekret niż klucz Garmin**.

Połączenie chmurowe wymaga osiągalnego serwera przez HTTPS lub obsługiwanej przez klienta metody tunelowania. Samo uruchomienie na localhost nie konfiguruje ChatGPT. Projekt nie publikuje serwera ani nie zmienia konfiguracji Twoich aplikacji automatycznie.

### OAuth dla osobistego dostępu

Serwer obsługuje rolę OAuth **resource server** z zewnętrznym dostawcą OIDC, który wystawia podpisane JWT access tokens. Nie implementuje własnego logowania ani przechowywania haseł.

W dostawcy OAuth skonfiguruj aplikację klienta ChatGPT/Claude, Authorization Code + PKCE, zgodne adresy callback, scope `mcp` i API/audience dla serwera. Jeżeli dostawca nie obsługuje dynamicznej rejestracji klientów, zarejestruj klientów ręcznie i podaj ich dane w obsługiwanej konfiguracji klienta MCP.

```dotenv
HOST=0.0.0.0
MCP_PUBLIC_URL=https://garmin.example.com/mcp
OAUTH_ISSUER=https://twoj-dostawca.example.com/
OAUTH_SUBJECT=identyfikator-twojego-konta-u-dostawcy
OAUTH_AUDIENCE=https://garmin.example.com/mcp
OAUTH_SCOPE=mcp
```

`OAUTH_SUBJECT` ogranicza dostęp do jednego, konkretnego konta właściciela danych. Weryfikowane są podpis JWT, issuer, audience, wygaśnięcie, subject i scope. Metadane protected resource są publikowane przez SDK MCP. Provider musi oferować discovery pod `<issuer>/.well-known/openid-configuration` i JWKS przez HTTPS. Tokeny opaque/introspection nie są obsługiwane. OAuth ma pierwszeństwo przed statycznym tokenem; nie ma automatycznego fallbacku omijającego weryfikację.

Postaw przed aplikacją reverse proxy HTTPS, zachowujące `Host`, `Authorization`, metody i treść żądań. `MCP_PUBLIC_URL` ma mieć dokładnie ścieżkę `/mcp`. Jeżeli klient wysyła nagłówek `Origin`, dodaj jego dokładny adres do `ALLOWED_ORIGINS` (lista po przecinku); brak wildcard. Domyślnie obce Host i Origin są odrzucane. Nie wystawiaj portu backendu z pominięciem HTTPS. Dla klientów obsługujących statyczne nagłówki możliwy jest osobny `MCP_ACCESS_TOKEN`, ale nie zastępuje on konfiguracji OAuth wymaganej przez wybrany klient.

Gotowy jest też `Dockerfile` (sekrety podawaj przez środowisko; zamontuj trwały katalog `/app/data`). Konfiguracja i rzeczywiste połączenie z dostawcą OAuth oraz kontami ChatGPT/Claude pozostają etapem wdrożenia.

Przed dodaniem serwera do aplikacji sprawdź:

```sh
# Zastąp przykładową domenę własną; te odczyty nie zawierają sekretów.
curl -fsS https://garmin.example.com/health
curl -fsS https://garmin.example.com/.well-known/oauth-protected-resource/mcp
```

Pierwszy adres powinien zwrócić `status: ok`, drugi metadane z Twoim zasobem `/mcp` i dostawcą autoryzacji. Samo działające `/health` nie sprawdza jeszcze logowania ani działania narzędzi.

### ChatGPT — dodanie własnego MCP

Instrukcja odpowiada aktualnej ścieżce **Plugins → Add custom MCP server** w oficjalnej dokumentacji OpenAI. Dostępność zależy od konta i zasad workspace; nazwy widoków mogą różnić się w starszym interfejsie.

1. Przygotuj działający zdalny serwer i OAuth według sekcji powyżej. Uruchom go przez `npm run start:http` za reverse proxy HTTPS.
2. Otwórz ChatGPT w przeglądarce i przejdź do **Plugins**.
3. Wybierz **+ → Add custom MCP server**.
4. Wpisz nazwę **Garmin**, a w **Connection → Server URL** podaj `https://garmin.example.com/mcp` z własną domeną.
5. Wybierz **OAuth**. W razie ręcznej rejestracji klienta podaj Client ID/Client Secret od swojego dostawcy OAuth. To nie jest klucz Garmin ani `MCP_ACCESS_TOKEN`.
6. Przejrzyj informacje o uprawnieniach i utwórz plugin przez **Create as a plugin**. Dokończ logowanie na konto wskazane w `OAUTH_SUBJECT`.
7. Zainstaluj utworzony plugin w swoim koncie/workspace. W nowej rozmowie wpisz `@`, wybierz **Garmin** i poproś o wywołanie `server_status`.
8. Przetestuj: „Użyj Garmin i przeanalizuj moje HRV z ostatnich 7 zakończonych dni”.

Ten wariant używa OAuth. Statyczny `MCP_ACCESS_TOKEN` z naszego `.env` nie jest Client Secretem OAuth. Nie wybieraj **No authentication** dla tak skonfigurowanego serwera — żądania zakończą się 401.

Alternatywą dla publicznego endpointu jest **Secure MCP Tunnel**, wybierany w polu **Connection → Tunnel**. Wymaga osobnej konfiguracji według dokumentacji OpenAI; projekt nie zawiera automatycznej konfiguracji tunelu. Wklejenie `http://localhost:3000/mcp` do pola zdalnego URL nie zastępuje tego kroku.

Źródła: [dodanie własnego MCP do ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

### Claude — zdalny connector

1. Przygotuj ten sam endpoint HTTPS i OAuth. Lokalna konfiguracja `claude_desktop_config.json` z wcześniejszej sekcji służy osobnemu wariantowi stdio.
2. Na koncie osobistym otwórz **Customize → Connectors → + Add → Add custom connector**.
3. Podaj nazwę **Garmin** i URL `https://garmin.example.com/mcp` z własną domeną. Wybierz **Continue**.
4. Sprawdź wykryte uwierzytelnianie. Wybierz **Sign in now** i metodę klienta zgodną z Twoim dostawcą OAuth; przy rejestracji ręcznej użyj **Use your own OAuth client**.
5. Dodaj connector i zaloguj się na konto wskazane w `OAUTH_SUBJECT`.
6. W rozmowie otwórz **+ → Connectors**, włącz **Garmin** i poproś o `server_status`, a potem o `health_report` dla ostatniego zakończonego tygodnia.

W Team/Enterprise dodanie connectora może wymagać właściciela lub odpowiedniej roli organizacyjnej; administrator dodaje go w **Organization settings → Connectors**, a użytkownik łączy własne konto.

Zdalne połączenie wychodzi z infrastruktury Anthropic również przy korzystaniu z Claude Desktop. Serwer musi być z niej osiągalny; lokalny adres komputera nie wystarczy.

Źródło: [oficjalna instrukcja custom connectorów Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Problemy z połączeniem

| Objaw | Co sprawdzić |
| --- | --- |
| Claude Desktop nie uruchamia `garmin` | Logi lokalnego MCP w ustawieniach; poprawny JSON, pełne ścieżki i Node 24+. Wygeneruj ponownie `npm run --silent config:claude`. |
| `GARMIN_API_KEY` nie jest ustawiony | Uruchom `npm run setup` w projekcie; sekret jest odczytywany z `.env` w katalogu projektu. |
| URL działa u Ciebie, ale zdalny klient się nie łączy | Zewnętrzna osiągalność HTTPS, certyfikat, firewall i zachowanie nagłówków przez proxy. |
| HTTP 401 | Oddziel klucz Garmin od uwierzytelnienia MCP; w OAuth sprawdź issuer, audience, subject, scope `mcp`, wygaśnięcie oraz odświeżanie tokena u dostawcy. |
| HTTP 403 z backendu | `Host` powinien pasować do domeny `MCP_PUBLIC_URL`. Jeżeli występuje `Origin`, wpisz dokładny, zaufany adres w `ALLOWED_ORIGINS`. |
| Brak opcji dodania własnego MCP | Sprawdź bieżące funkcje konta i uprawnienia workspace w dokumentacji klienta. |
| Widać tylko stare narzędzia | Uruchom ponownie lokalny proces lub wdrożenie HTTP, potem odśwież listę narzędzi w kliencie. |

Połączenie jest sprawdzone dopiero po udanym wywołaniu narzędzia, nie po samym zapisaniu URL. W tym repozytorium przetestowano protokół stdio/HTTP i prawdziwe API Garmin; instrukcja nie oznacza, że Twoje konta ChatGPT/Claude są już podłączone.

Źródła: [ChatGPT custom MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Claude MCP](https://claude.com/docs/connectors/building), [Garmin Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/), [Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/).

## Narzędzia

| Narzędzie | Zastosowanie |
| --- | --- |
| `server_status` | Tryb, strefa czasowa, możliwości i ograniczenia |
| `list_activities` | Wyszukiwanie po dacie, nazwie i dyscyplinie; identyfikatory do dalszej analizy |
| `analyze_last_training` | Ostatni trening z kontekstem regeneracji i porównaniem historycznym |
| `analyze_training` | Wskazany trening, metryki dyscypliny, siła i struktura wykonanego workoutu |
| `analyze_training_week` | Tydzień aktywności, obciążenia, snu, HRV, stresu i Body Battery |
| `summarize_recovery` | Dzień na tle własnej normy i ostatnich 7 dni |
| `analyze_hrv` | Nocne HRV, średnia tygodniowa, status i zakres BALANCED Garmina, tętno spoczynkowe |
| `analyze_stress` | Poziom stresu fizjologicznego i czas wysokiego/średniego/niskiego stresu oraz odpoczynku |
| `analyze_sleep` | Sen, stadia, wybudzenia, drzemki, regularność pory zaśnięcia, oddech |
| `analyze_body_battery` | Body Battery rano, zakres dzienny, ładowanie, zużycie i ładowanie podczas snu |
| `health_report` | Zbiorczy raport trendów zdrowotnych, bez sztucznej wspólnej oceny zdrowia |
| `analyze_load` | Obciążenie okresu i porównanie z poprzednim równym okresem |
| `find_correlations` | Eksploracyjne zależności i przesunięcia o 1 dzień |
| `suggest_today_training` | Propozycja sesji lub odpoczynku bez zmiany planu |
| `plan_training` | Propozycja planu pod cel; automatyczny szablon lub szczegółowe `customSessions` |
| `adapt_plan` | Propozycja aktualizacji planu, niedostępność, opuszczone sesje i `replacements` |
| `get_training_plan` | Aktywny plan i opcjonalna historia wersji |
| `commit_training_plan` | Zatwierdzenie konkretnej propozycji przy zgodnej rewizji planu |
| `log_wellbeing` | Dziennik energii, bolesności, bólu i notatek; RPE/RIR konkretnej aktywności |

Przykłady rozmów:

- „Przeanalizuj ostatni trening siłowy i uwzględnij mój sen”.
- „Znajdź sobotni trening pływacki i oceń jego intensywność”.
- „Podsumuj tydzień od 2026-10-19 razem z regeneracją”.
- „Porównaj obciążenie ostatnich 14 dni z poprzednimi 14”.
- „Sprawdź, czy trening dzień wcześniej wiąże się z moim snem lub HRV”.
- „Przeanalizuj moje HRV z ostatnich 14 dni na tle poprzednich czterech tygodni”.
- „Czy ostatnio mam więcej czasu w wysokim stresie i mniej odpoczynku?”.
- „Sprawdź regularność snu, wybudzenia i drzemki”.
- „Jak wygląda moje ładowanie Body Battery w ostatnim tygodniu?”.
- „Ułóż plan na cztery tygodnie pod zawody, z rowerem, pływaniem, bieganiem i siłą; mam czas w poniedziałki, środy, piątki i soboty”.
- „Nie mogę trenować w piątek. Pokaż proponowaną zmianę planu”.

### Planowanie i zatwierdzanie

Model powinien najpierw zebrać cel, datę zawodów, doświadczenie, preferowane dyscypliny, dostępne dni/czas oraz ograniczenia. Potem odczytać historię i regenerację. `plan_training` przyjmuje `goal`, `startDate`, `endDate`, `availability` (weekday 1–7, minuty) i opcjonalnie `customSessions`.

Generator domyślny tworzy spokojny szkic na podstawie średniej objętości z poprzednich 28 dni, rotacji dyscyplin, dostępności, tygodnia odciążającego co czwarty tydzień i zmniejszenia objętości przed zawodami. Nie wyznacza automatycznie progów, tempa docelowego ani specjalistycznego planu pod wynik z samego opisu celu. Aby zaplanować konkretne interwały, ćwiczenia lub periodyzację, model przekazuje szczegółowe `customSessions` z uzasadnieniem w instrukcjach. Dla braku historii szkic używa jawnego roboczego budżetu 90 min/tydzień, a nie domniemanej sprawności użytkownika.

Nowy plan i adaptacja są najpierw **propozycją**. Model pokazuje użytkownikowi sesje lub `changes`. Po zatwierdzeniu wywołuje `commit_training_plan` z `proposalId`, `expectedRevision` i `userConfirmed: true`. Serwer sprawdza rewizję, ważność propozycji (24 h), chroni przed ponownym zapisem i zachowuje poprzednią wersję. `userConfirmed` jest deklaracją klienta/modelu; serwer nie potrafi sam zweryfikować treści rozmowy ani zastąpić zgody w interfejsie klienta.

Adaptacja domyślna odwołuje niedostępne sesje, oznacza wskazane opuszczone sesje i zmniejsza objętość dzisiaj/jutro przy sygnałach gorszej regeneracji. Nie upycha opuszczonej pracy w kolejnych dniach. Dla przełożenia sesji podaj `replacements`. Dopasowanie wykonania po dacie i dyscyplinie jest oznaczone jako przybliżone.

## Metody i kompletność

- Garmin Load, TSS, sRPE (minuty × RPE) i kg × powtórzenia są raportowane osobno. Nie sumujemy kilometrów różnych sportów jako wspólnej miary obciążenia.
- Pola siłowe `maxWeight` i `volume` ze Swaggera są w gramach: wynik pokazuje kg i kg×powtórzenia. Czas zestawu jest w milisekundach. Ciężar kroku workoutu jest już w kg.
- Brakujące lub nieważne wartości pozostają `null`. Każda suma ma licznik dostępnych pomiarów. Nie porównujemy Garmin Load procentowo, gdy pokrycie jest niepełne.
- Regeneracja porównuje dzień z medianą poprzednich 7–56 dni (domyślnie 28), minimum 7 pomiarów dla metryki. Heurystyczne flagi: sen/HRV/Body Battery rano poniżej 80% mediany lub RHR wyższe o ≥7 bpm. Własny ból, bolesność ≥7/10 lub energia ≤3/10 również są sygnałem ostrożności. Progi są ustawieniami produktu, nie zwalidowanym testem medycznym ani odwzorowaniem Garmin Training Readiness.
- Stan `typical` wymaga minimum 3 porównywalnych metryk; brak pomiarów daje `insufficient_data`. Dzisiejsze dane mogą być niepełne — wynik zawiera `lastSyncUtc`, daty pobrania i pokrycie.
- Osobne analizy zdrowotne obejmują do 60 dni i 7–28 wcześniejszych dni odniesienia. Raportują średnią, medianę, minimum, maksimum i pokrycie. Zmiana względem wcześniejszej mediany wymaga ≥7 dni odniesienia i ≥3 dni okresu; analiza jednego dnia nie udaje trendu. Dzisiejszy dzień oznaczany jest jako potencjalnie niekompletny.
- Status i zakres HRV to dane Garmina, nie własna diagnoza. Zakres `BALANCED` porównywany jest ze średnią tygodniową Garmina. Rozkład stresu ma czasy w minutach; nie jest interpretowany jako ocena zdrowia psychicznego. Regularność snu uwzględnia przejście przez północ. `sleepNeed.actual` nie jest przeliczane, ponieważ Swagger nie określa jego jednostki. Ładowanie i zużycie Body Battery są osobnymi metrykami, nie jednostkami energii.
- Korelacje Pearsona wymagają minimum 14 kompletnych par, daty końcowej najpóźniej wczoraj i kompletnej listy aktywności. Sen jest przypisany do daty przebudzenia. Wyniki są eksploracyjne, bez dowodu przyczynowości, kontroli czynników zakłócających i testów istotności.
- Aktywności wielosportowe są deduplikowane: gdy dostępne są składowe, rodzic nie jest liczony drugi raz.
- Maks. 180 dni aktywności, 90 dni analizy obciążenia/zależności i 180 dni planu. Wyszukiwanie kończy się po 2000 rekordów i jawnie oznacza niekompletność. Błędy pojedynczych źródeł zdrowotnych dają ostrzeżenia, bez udawania pełnych danych.

## Stan, sekrety i ograniczenia

Plany, ich propozycje, historia i dziennik są zapisane w `data/state.sqlite` (tryb WAL, plik `600`, tworzony katalog `700`). Jest to lokalny plik, bez szyfrowania aplikacyjnego; chroń dysk i kopie zapasowe. Cache pomiarów i token Garmin istnieją tylko w pamięci procesu. Zapytania GET mają cache 5 min, timeout, ograniczony retry/backoff i odnowienie tokena po wygaśnięciu lub jednym 401. Błędy API nie wypisują treści odpowiedzi ani sekretów.

Do modelu trafiają wybrane metryki i nazwy treningów. Serwer nie zwraca współrzędnych GPS, profilu społecznościowego ani pełnego surowego JSON konta. Wybierając klienta AI, uwzględnij jego ustawienia przetwarzania danych.

Wersja 0.1 nie zawiera parsera FIT, dokładnych próbek interwałów/dryfu tętna, wysyłania treningów do zegarka, cyklicznych powiadomień ani panelu WWW. Personal Swagger udostępnia odczyt: `workouts` oznacza trening wykonany w aktywności, nie tworzenie przyszłego workoutu. Szczegółowy plan pozostaje w bazie tego serwera.

## Weryfikacja

```sh
npm run check
npm test
npm audit
```

`npm run verify:garmin -- --deep` dodatkowo sprawdza normalizację regeneracji i analizę prawdziwej aktywności bez wypisywania prywatnych pomiarów. Weryfikacja wymaga odczytu kilkudziesięciu dziennych podsumowań z API.

`npm run verify:garmin -- --health` sprawdza również raport zdrowotny i nowe endpointy stresu/Body Battery. Wyświetla wyłącznie liczbę dostępnych typów metryk i ostrzeżenia źródeł.

Testy obejmują obliczenia i jednostki, daty/strefy czasowe, brakujące dane, deduplikację, token/cache/retry, walidację dostępności, wersjonowanie planów oraz integrację wszystkich narzędzi przez oficjalny klient MCP. Osobne testy sprawdzają prawdziwy proces stdio i uwierzytelniony HTTP na tymczasowym porcie localhost. Test HTTP wymaga środowiska pozwalającego na lokalny nasłuch. Testy nie używają prawdziwego klucza.
