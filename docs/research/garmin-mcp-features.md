# Garmin MCP — możliwości i zakres

Stan dokumentacji: 28 października 2026. Poniższe propozycje są decyzjami projektowymi, a nie obietnicą dostępności każdego pola w API. Zakres endpointów sprawdzono również w renderowanym Swaggerze.

## Przyjęty zakres i implementacja

Użytkownik wybrał dziewięć funkcji: analiza ostatniego treningu, wskazanego treningu, tygodnia z kontekstem wypoczynku; sugestia dzisiejszej sesji; plan pod cel/zawody; adaptacja; wyszukiwanie zależności; podsumowanie regeneracji; analiza obciążenia. Dyscypliny: bieganie, kolarstwo, pływanie i trening siłowy. Wersja 0.1 implementuje ten zakres przez 14 narzędzi MCP, trwały SQLite i transporty stdio/Streamable HTTP. Szczegółowe możliwości i ograniczenia opisuje `README.md`.

Rozszerzenie zdrowotne dodaje pięć narzędzi (łącznie 19): osobne analizy HRV, stresu, snu, Body Battery i zbiorczy `health_report`. Wykorzystuje dodatkowo zakresowy endpoint stresu oraz raporty Body Battery. Dane są porównywane z osobistą historią, z jawnym pokryciem i bez diagnoz. Pozostałe możliwe moduły ze Swaggera, jeszcze niezaimplementowane: SpO₂, masa/skład ciała, nawodnienie, żywienie i Fitness Age; zależą od dostępnych zapisów i urządzeń.

Weryfikacja prawdziwego Personal API potwierdziła odpowiedź tokena `text/plain`; nagłówek `Accept: application/json` na endpoint tokena powodował HTTP 406. Klient nie wymusza tam JSON i obsługuje tekstowy token. Potwierdzono wyszukiwanie aktywności, dostęp do snu/HRV/podsumowania dnia, normalizację sześciu typów metryk regeneracji i analizę prawdziwej aktywności bez ostrzeżeń źródeł. Dane i sekrety nie są częścią raportu.

## Potwierdzone podstawy Garmina

Personal API służy do własnych danych pojedynczego użytkownika; Garmin odróżnia je od komercyjnego programu integracji dla wielu użytkowników. Klucz wymienia się na token przez `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`, z nagłówkiem `Authorization: ApiKey …`. Token działa do 24 godzin lub wygaśnięcia klucza. Brak refresh tokena: serwer pobiera następny token tym samym mechanizmem. Klucz może wygasać po 30, 90, 180 dniach lub roku; jego usunięcie unieważnia powiązane tokeny. [Garmin Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)

## Zakres potwierdzony w Swaggerze

Renderowany Swagger Personal API udostępnia operacje GET, bez operacji tworzenia treningów lub wpisów kalendarza. Wyszukiwanie aktywności ma filtry typu/podtypu, dat, zdarzenia, dystansu i czasu oraz stronicowanie. Podsumowania aktywności zawierają m.in. czasy w strefach tętna, `activityTrainingLoad`, TSS, VO₂max oraz dane mocy i serie ćwiczeń, zależnie od aktywności. Nie ma osobnego endpointu Training Readiness lub Training Status, więc nie należy obiecywać odtworzenia wyniku Garmina.

`GET /activity-service/activity/{activityId}/workouts` zwraca treningi wykonane podczas aktywności, nie tworzy przyszłych treningów. `GET /download-service/files/activity/{activityId}` pobiera archiwum z oryginalnym plikiem aktywności. Szczegółowe analizy próbek można dobudować przez parser FIT, jeżeli oryginał faktycznie jest FIT i zawiera potrzebne pola; nie traktować ich jako gwarantowanych pól JSON API. [Swagger Personal API — sprawdzono w przeglądarce 28.10.2026](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)

## Propozycje funkcji

| Funkcja | Wartość | Zależności do potwierdzenia |
| --- | --- | --- |
| Analiza ostatniego treningu | Wykonanie, intensywność, rozkład tempa/tętna i najważniejsze obserwacje | Podsumowania i strefy są dostępne; próbki i okrążenia zależą od oryginalnego pliku i parsera |
| Raport tygodnia i trendów | Objętość, regularność, udział intensywności, porównanie okresów | Historia aktywności i kompletność danych |
| Porównanie podobnych sesji | Czy przy podobnym tempie spada tętno; czy interwały są równiejsze | Próbki, warunki, profil trasy; porównania trzeba opatrzyć ograniczeniami |
| Kontekst regeneracji | Sen, HRV i tętno spoczynkowe jako kontekst propozycji treningu | Dostępność tych metryk w Personal API i urządzeniu |
| Plan pod konkretny cel | Plan tygodnia uwzględniający cel, historię, czas i preferowane dni | Profil celu przechowywany przez nas; plan można proponować bez zapisu w Garminie |
| Adaptacja planu | Przesunięcie sesji po opuszczeniu treningu, aktualizacja po tygodniu | Własny trwały plan i porównanie z wykonaniem |
| Treningi strukturalne | Rozgrzewka, odcinki, odpoczynki, schłodzenie | Obecny Swagger ma tylko odczyt; szkic w naszym systemie jest możliwy, wysyłka przez Personal API nie jest potwierdzona |
| Dziennik samopoczucia | Łączy wykonanie z RPE, bólem, stresem i notatkami | Nasz magazyn danych; nie zakładać zapisu tych danych przez Garmina |
| Automatyczny raport | Podsumowanie po synchronizacji lub co tydzień | Osobny harmonogram/zadanie i kanał dostarczenia; samo MCP nie uruchamia modeli cyklicznie |

Wskaźniki liczymy po stronie serwera w powtarzalny sposób; model interpretuje wyniki i uzasadnia propozycje. Brak danych ma być widoczny, a nie zastępowany zerem. Rekomendowane minimum: analiza sesji, trendy, profil celu i szkic tygodnia. Bezpośredni zapis do Garmina wykracza poza potwierdzony zakres Personal API; w pierwszej wersji plan pozostaje w naszym systemie.

## ChatGPT i Claude — wspólna architektura

ChatGPT obsługuje własne MCP z narzędziami odczytu i zapisu, SSE oraz streaming HTTP. Dokumentacja wskazuje dodanie URL serwera lub Secure MCP Tunnel oraz konfigurację OAuth. Narzędzia `search` i `fetch` nie są obowiązkowe. Odczyty należy oznaczyć `readOnlyHint`; zapisy domyślnie wymagają potwierdzania. Dostęp zależy także od uprawnień workspace i ograniczeń konta. [Oficjalna dokumentacja OpenAI: custom MCP](https://developers.openai.com/api/docs/guides/custom-mcp-server)

Claude zaleca Streamable HTTP; starszy HTTP+SSE jest wycofywany. Obsługuje OAuth, statyczne nagłówki lub brak uwierzytelniania, a także narzędzia, prompty i zasoby. Odpowiedzi i operacje muszą mieścić się w limitach klienta, więc historię należy stronicować i agregować. UI w rozmowie jest opcjonalne. [Budowanie serwera MCP dla Claude](https://claude.com/docs/connectors/building)

Zdalny connector Claude łączy się z infrastruktury Anthropic, także w aplikacji desktopowej; wymaga osiągalnego z niej serwera. Lokalny MCP w konfiguracji Claude Desktop to osobny mechanizm. [Claude: custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

Rekomendacja projektowa: jeden serwer Streamable HTTP przez HTTPS, prywatny dostęp przez OAuth i osobny, wewnętrzny klient Garmin. Uwierzytelnienie klienta MCP i klucz Garmina to dwie różne warstwy. Klucz Garmina pozostaje w sekretach backendu. Opcjonalny transport stdio może służyć lokalnemu Claude Desktop. Cache, retry z backoff, obsługa wygaśnięcia tokena i rejestrowanie tylko bezpiecznych metadanych powinny należeć do pierwszej wersji. Limity Garmina i dostępność historii trzeba potwierdzić przed ustaleniem strategii synchronizacji.
