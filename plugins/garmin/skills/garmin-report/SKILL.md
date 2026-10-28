---
name: garmin-report
description: Przygotuj raport treningów lub regeneracji z Garmin MCP, także podczas lokalnego scheduled task.
---

Korzystaj z narzędzi serwera `garmin` dostarczonego przez ten plugin.

1. Wywołaj `server_status`. Używaj zwróconej strefy czasowej do ustalenia dat względem czasu bieżącego uruchomienia. Tryb `DEMO_SYNTHETIC_DATA` oznacz wyraźnie jako dane demonstracyjne. Jeśli serwer jest niedostępny, zgłoś błąd połączenia; zakończ raport bez zastępowania pomiarów domysłami.
2. Dobierz odczyty do prośby:
   - Raport poranny: `summarize_recovery` dla dzisiaj; `suggest_today_training` tylko jeśli użytkownik chce także propozycję treningu.
   - Tydzień: `analyze_training_week` z datą poniedziałku ostatniego zakończonego tygodnia, chyba że użytkownik wskazał inny okres.
   - Trendy zdrowotne: `health_report` dla ostatnich 7 zakończonych dni lub wskazanego okresu.
   - Konkretny trening: `list_activities`, następnie `analyze_training` z otrzymanym identyfikatorem, albo `analyze_last_training` dla ostatniego treningu.
3. Podaj analizowany okres, najważniejsze obserwacje, porównanie z własną historią, kompletność danych i praktyczny wniosek. Uwzględnij ostrzeżenia oraz czas synchronizacji, jeśli są dostępne. Dzisiejsze pomiary mogą być niepełne. Brak pomiaru pozostaje brakiem, a heurystyki regeneracji i korelacje nie stanowią diagnozy.

Scheduled task odczytuje aktualne dane przy każdym uruchomieniu. Daty obliczaj na nowo, zamiast kopiować je z poprzedniego raportu. Raportowanie nie wymaga zapisu: nie wywołuj `log_wellbeing`, `plan_training`, `adapt_plan` ani `commit_training_plan` w ramach raportu. Zmianę planu obsługuj jako osobną prośbę; zatwierdzenie propozycji wymaga zgody użytkownika na konkretne zmiany.

Odpowiadaj po polsku, chyba że użytkownik wybierze inny język. Stosuj zakres i zasady powiadomień podane w zadaniu. Samo wywołanie tego skilla nie tworzy harmonogramu.
