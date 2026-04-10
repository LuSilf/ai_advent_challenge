# Spring Boot — последние 2 вмердженных PR

## PR #49885 — HTTP method is lost when configuring excludes in EndpointRequest
- **Автор:** dlwldnjs1009
- **URL:** https://github.com/spring-projects/spring-boot/pull/49885
- **Merged:** 2026-04-07T15:11:31Z

PR исправляет проблему, при которой метод HTTP, настроенный через EndpointRequest.withHttpMethod(), терялся при цепочке исключений (excluding(Class<?>...), excluding(String...), excludingLinks()). Это происходило потому, что каждый exclusion создавал новый матчер без сохранённой конфигурации метода. Исправление сохраняет заданный HttpMethod в сервлетной и реактивной версиях EndpointRequest и добавляет регрессионные тесты для цепочек исключений. Тесты запускаются для servlet- и reactive-версий через Gradle и включает checkFormatTest; благодарность участнику dlwldnjs1009 и признательность bclozel.

## PR #49942 — 500 response from env endpoint when supplied pattern is invalid
- **Автор:** dlwldnjs1009
- **URL:** https://github.com/spring-projects/spring-boot/pull/49942
- **Merged:** 2026-04-07T15:34:00Z

PR #49942 исправляет 500 ответ при передачи неверного паттерна в EnvironmentEndpoint. Неправильный regex вызывает PatternSyntaxException, который не обрабатывается веб-слоем и приводит к 500. Изменение: оборачиваем PatternSyntaxException в InvalidEndpointRequestException, чтобы использовать стандартный путь обработки некорректного запроса и возвращать 400 (закрывает gh-49884).
