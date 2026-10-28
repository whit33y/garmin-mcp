# Garmin dla Claude Desktop

Zbuduj plik instalacyjny w repozytorium: `npm ci`, potem `npm run plugin:build:claude`.

W Claude Desktop otwórz **Settings → Desktop app → Extensions → Manage → Advanced settings → Install Extension…** i wybierz `dist/garmin-0.1.0.mcpb`. Starsze wersje mają osobną sekcję **Settings → Extensions**.

W formularzu podaj wyłącznie **klucz Garmin Personal API** (`GARMIN_API_KEY`). Pole jest oznaczone jako sekret (`sensitive`); Claude zarządza jego bezpiecznym przechowywaniem. Nie wpisuj klucza do rozmowy. Nie trzeba przygotowywać `.env`.

Pozostałe ustawienia są automatyczne: region `com`, strefa czasowa systemu, baza i tokeny w `~/.garmin-personal-mcp/data`. Dane pozostają poza katalogiem instalacji i przetrwają aktualizację paczki. Rozszerzenie korzysta z własnej bazy, oddzielnej od bazy w repozytorium.

W nowej rozmowie włącz Garmin w Connectors i poproś: „Wywołaj server_status, potem podsumuj moją regenerację z dzisiaj”. Tryb powinien być `GARMIN`.

Rozszerzenie zawiera zależności i wymaga runtime Node.js 24+ (używa `node:sqlite`). Claude Desktop dostarcza własny Node; jeżeli jego wersja nie spełnia wymagania, zaktualizuj aplikację. Pakiet nie zawiera runtime Node ani danych konta. Nie jest powiązany ze ścieżką repozytorium.

Źródła: [instalacja i konfiguracja rozszerzeń](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [specyfikacja MCPB](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md).
