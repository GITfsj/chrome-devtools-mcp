/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getConsoleMessage,
  listConsoleMessages,
} from '../../src/tools/console.js';
import {withBrowser} from '../utils.js';

describe('console', () => {
  describe('list_console_messages', () => {
    it('list messages', async () => {
      await withBrowser(async (response, context) => {
        await listConsoleMessages.handler({params: {}}, response, context);
        assert.ok(response.includeConsoleData);
      });
    });

    it('lists error messages', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.newPage();
        await page.setContent(
          '<script>console.error("This is an error")</script>',
        );
        await listConsoleMessages.handler({params: {}}, response, context);
        const formattedResponse = await response.handle('test', context);
        const textContent = formattedResponse[0] as {text: string};
        assert.ok(
          textContent.text.includes('msgid=1 [error] This is an error'),
        );
      });
    });

    it('work with primitive unhandled errors', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.newPage();
        await page.setContent('<script>throw undefined;</script>');
        await listConsoleMessages.handler({params: {}}, response, context);
        const formattedResponse = await response.handle('test', context);
        const textContent = formattedResponse[0] as {text: string};
        assert.ok(
          textContent.text.includes('msgid=1 [error] undefined (0 args)'),
        );
      });
    });

    it('lists messages in reverse order', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.newPage();
        await page.setContent(
          '<script>console.log("first"); console.log("second"); console.log("third");</script>',
        );
        await listConsoleMessages.handler(
          {params: {reverse: true}},
          response,
          context,
        );
        const formattedResponse = await response.handle('test', context);
        const textContent = formattedResponse[0] as {text: string};
        const lines = textContent.text.split('\n');
        const messageLines = lines.filter(line => line.includes('[log]'));
        // 倒序时，最新的消息应该在前面
        assert.ok(messageLines[0].includes('third'));
        assert.ok(messageLines[1].includes('second'));
        assert.ok(messageLines[2].includes('first'));
      });
    });

    it('lists messages in chronological order by default', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.newPage();
        await page.setContent(
          '<script>console.log("first"); console.log("second"); console.log("third");</script>',
        );
        await listConsoleMessages.handler({params: {}}, response, context);
        const formattedResponse = await response.handle('test', context);
        const textContent = formattedResponse[0] as {text: string};
        const lines = textContent.text.split('\n');
        const messageLines = lines.filter(line => line.includes('[log]'));
        // 默认顺序时，最早的消息应该在前面
        assert.ok(messageLines[0].includes('first'));
        assert.ok(messageLines[1].includes('second'));
        assert.ok(messageLines[2].includes('third'));
      });
    });
  });

  describe('get_console_message', () => {
    it('gets a specific console message', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.newPage();
        await page.setContent(
          '<script>console.error("This is an error")</script>',
        );
        // The list is needed to populate the console messages in the context.
        await listConsoleMessages.handler({params: {}}, response, context);
        await getConsoleMessage.handler(
          {params: {msgid: 1}},
          response,
          context,
        );
        const formattedResponse = await response.handle('test', context);
        const textContent = formattedResponse[0] as {text: string};
        assert.ok(
          textContent.text.includes('msgid=1 [error] This is an error'),
          'Should contain console message body',
        );
      });
    });
  });
});
