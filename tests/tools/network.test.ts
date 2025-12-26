/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getNetworkDetail,
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

    it('filters requests by filterText', async () => {
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
              filterText: 'two',
            },
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        const textContent = responseData[0] as {text: string};
        assert.ok(textContent.text.includes('/two'));
        assert.ok(!textContent.text.includes('/one'));
        assert.ok(!textContent.text.includes('/three'));
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
  describe('network_get_detail', () => {
    it('should get all data by default', async () => {
      server.addHtmlRoute('/test', html`<main>Test Page</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/test'));
        
        await getNetworkDetail.handler(
          {
            params: {
              reqid: 1,
            },
          },
          response,
          context,
        );
        
        assert.equal(response.attachedNetworkRequestId, 1);
        const responseData = await response.handle('get_detail', context);
        const textContent = responseData[0] as {text: string};
        assert.ok(textContent.text.includes('both request and response data'));
      });
    });

    it('should get request data only', async () => {
      server.addHtmlRoute('/test', html`<main>Test Page</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/test'));
        
        await getNetworkDetail.handler(
          {
            params: {
              reqid: 1,
              dataType: 'request',
            },
          },
          response,
          context,
        );
        
        const responseData = await response.handle('get_detail', context);
        const textContent = responseData[0] as {text: string};
        assert.ok(textContent.text.includes('request data only'));
        assert.ok(textContent.text.includes('Request Headers'));
      });
    });

    it('should get response data only', async () => {
      server.addHtmlRoute('/test', html`<main>Test Page</main>`);

      await withBrowser(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/test'));
        
        await getNetworkDetail.handler(
          {
            params: {
              reqid: 1,
              dataType: 'response',
            },
          },
          response,
          context,
        );
        
        const responseData = await response.handle('get_detail', context);
        const textContent = responseData[0] as {text: string};
        assert.ok(textContent.text.includes('response data only'));
        assert.ok(textContent.text.includes('Response Headers'));
      });
    });

    it('should work with list_network_requests integration', async () => {
      server.addHtmlRoute('/page1', html`<main>Page 1</main>`);
      server.addHtmlRoute('/page2', html`<main>Page 2</main>`);

      await withBrowser(async (response1, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPage();
        await page.goto(server.getRoute('/page1'));
        await page.goto(server.getRoute('/page2'));
        
        // 首先列出所有请求
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
            },
          },
          response1,
          context,
        );
        
        const listResponse = await response1.handle('list_requests', context);
        const listText = listResponse[0] as {text: string};
        
        // 从列表中找到 reqid（通常格式为 reqid=1）
        const reqidMatch = listText.text.match(/reqid=(\d+)/);
        assert.ok(reqidMatch, 'Should find reqid in list response');
        
        const reqid = parseInt(reqidMatch[1], 10);
        
        // 然后获取该请求的详细信息
        const response2 = {
          attachNetworkRequest: (id: number) => {
            response2.attachedNetworkRequestId = id;
          },
          appendResponseLine: (line: string) => {
            response2.lines.push(line);
          },
          attachedNetworkRequestId: undefined as number | undefined,
          lines: [] as string[],
        };
        
        await getNetworkDetail.handler(
          {
            params: {
              reqid,
              dataType: 'all',
            },
          },
          response2 as any,
          context,
        );
        
        assert.equal(response2.attachedNetworkRequestId, reqid);
        assert.ok(response2.lines.some(line => line.includes('both request and response data')));
      });
    });
  });
});
