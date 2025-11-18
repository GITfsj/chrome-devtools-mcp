/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getNetworkRequest,
  listNetworkRequests,
} from '../../src/tools/network.js';
import {serverHooks} from '../server.js';
import {html, withBrowser, stabilizeResponseOutput} from '../utils.js';

describe('network', () => {
  const server = serverHooks();
  describe('network_list_requests', () => {
    it('list requests', async () => {
      await withBrowser(async (response, context) => {
        await listNetworkRequests.handler({params: {}}, response, context);
        assert.ok(response.includeNetworkRequests);
        assert.strictEqual(response.networkRequestsPageIdx, undefined);
      });
    });

    it('list requests form current navigations only', async t => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await listNetworkRequests.handler(
          {
            params: {},
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        t.assert.snapshot?.(stabilizeResponseOutput(responseData[0].text));
      });
    });

    it('list requests from previous navigations', async t => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
            },
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        t.assert.snapshot?.(stabilizeResponseOutput(responseData[0].text));
      });
    });

    it('list requests from previous navigations from redirects', async t => {
      server.addRoute('/redirect', async (_req, res) => {
        res.writeHead(302, {
          Location: server.getRoute('/redirected'),
        });
        res.end();
      });

      server.addHtmlRoute(
        '/redirected',
        html`<script>
          document.location.href = '/redirected-page';
        </script>`,
      );

      server.addHtmlRoute(
        '/redirected-page',
        html`<main>I was redirected 2 times</main>`,
      );

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/redirect'));
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
            },
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        t.assert.snapshot?.(stabilizeResponseOutput(responseData[0].text));
      });
    });

    it('list requests in reverse order', async () => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
              reverse: true,
            },
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        const textContent = responseData[0] as {text: string};
        // 验证最新的请求 (three) 出现在最前面
        assert.ok(textContent.text.includes('/three'));
        const threeIndex = textContent.text.indexOf('/three');
        const twoIndex = textContent.text.indexOf('/two');
        const oneIndex = textContent.text.indexOf('/one');
        // 在倒序中，three 应该在 two 之前，two 应该在 one 之前
        assert.ok(threeIndex < twoIndex);
        assert.ok(twoIndex < oneIndex);
      });
    });

    it('list requests in chronological order by default', async () => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
            },
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        const textContent = responseData[0] as {text: string};
        // 验证最早的请求 (one) 出现在最前面
        assert.ok(textContent.text.includes('/one'));
        const oneIndex = textContent.text.indexOf('/one');
        const twoIndex = textContent.text.indexOf('/two');
        const threeIndex = textContent.text.indexOf('/three');
        // 在正序中，one 应该在 two 之前，two 应该在 three 之前
        assert.ok(oneIndex < twoIndex);
        assert.ok(twoIndex < threeIndex);
      });
    });
  });
  describe('network_get_request', () => {
    it('attaches request', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await getNetworkRequest.handler(
          {params: {reqid: 1}},
          response,
          context,
        );

        assert.equal(response.attachedNetworkRequestId, 1);
      });
    });
    it('should not add the request list', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await getNetworkRequest.handler(
          {params: {reqid: 1}},
          response,
          context,
        );
        assert(!response.includeNetworkRequests);
      });
    });
    it('should get request from previous navigations', async t => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await getNetworkRequest.handler(
          {
            params: {
              reqid: 1,
            },
          },
          response,
          context,
        );
        const responseData = await response.handle('get_request', context);

        t.assert.snapshot?.(stabilizeResponseOutput(responseData[0].text));
      });
    });
  });
});
