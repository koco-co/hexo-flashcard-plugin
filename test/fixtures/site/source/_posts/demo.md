---
title: Flashcard Demo
date: 2026-08-23 10:00:00
tags:
  - test
categories:
  - fixture
description: Integration fixture for the flashcard plugin.
flashcard_deck: HTTP 基础
---

{% flashcard basic id:http-404 tags:"状态码,客户端错误" priority:1 %}
--- question
HTTP 404 表示什么？
--- answer
请求的资源不存在。
--- explanation
服务器没有找到目标资源。
{% endflashcard %}

{% flashcard cloze id:http-cache tags:"缓存" priority:2 %}
--- question
强缓存通常由 [[Cache-Control]] 控制。
--- answer
Cache-Control
--- explanation
它声明浏览器和中间缓存的缓存策略。
{% endflashcard %}

{% flashcard choice id:http-success tags:"状态码" answer:A priority:3 %}
--- question
哪个状态码通常表示请求成功？
- [A] 200
- [B] 404
- [C] 500
--- answer
200 OK
--- explanation
200 的标准原因短语是 OK。
{% endflashcard %}
