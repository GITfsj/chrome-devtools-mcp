/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import type {ResourceType} from '../third_party/index.js';

import {
  getFormattedHeaderValue,
  getFormattedRequestBody,
  getFormattedResponseBody,
  getStatusFromRequest,
} from '../formatters/networkFormatter.js';
import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

const FILTERABLE_RESOURCE_TYPES: readonly [ResourceType, ...ResourceType[]] = [
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'prefetch',
  'eventsource',
  'websocket',
  'manifest',
  'signedexchange',
  'ping',
  'cspviolationreport',
  'preflight',
  'fedcm',
  'other',
];

export const listNetworkRequests = defineTool({
  name: 'list_network_requests',
  description: `List all requests for the currently selected page since the last navigation.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum number of requests to return. When omitted, returns all requests.',
      ),
    // pageIdx: zod
    //   .number()
    //   .int()
    //   .min(0)
    //   .optional()
    //   .describe(
    //     'Page number to return (0-based). When omitted, returns the first page.',
    //   ),
    resourceTypes: zod
      .array(zod.enum(FILTERABLE_RESOURCE_TYPES))
      .optional()
      .describe(
        'Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.',
      ),
    includePreservedRequests: zod
      .boolean()
      .default(false)
      .optional()
      .describe(
        'Set to true to return the preserved requests over the last 3 navigations.',
      ),
    filterText: zod
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional text to filter network requests. Matches URL, method, status, or reqid (case-insensitive).',
      ),
    reverse: zod
      .boolean()
      .default(true)
      .optional()
      .describe(
        'Set to true to return requests in reverse order (newest first). When false or omitted, returns requests in chronological order (oldest first). Default is true',
      ),
  },
  handler: async (request, response, context) => {
    const data = await context.getDevToolsData();
    response.attachDevToolsData(data);
    const reqid = data?.cdpRequestId
      ? context.resolveCdpRequestId(data.cdpRequestId)
      : undefined;
    response.setIncludeNetworkRequests(true, {
      pageSize: request.params.pageSize,
      // pageIdx: request.params.pageIdx,
      pageIdx: 0,
      resourceTypes: request.params.resourceTypes,
      includePreservedRequests: request.params.includePreservedRequests,
      filterText: request.params.filterText,
      networkRequestIdInDevToolsUI: reqid,
      reverse: request.params.reverse,
    });
  },
});

export const getNetworkRequest = defineTool({
  name: 'get_network_request',
  description: `Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .optional()
      .describe(
        'The reqid of the network request. If omitted returns the currently selected request in the DevTools Network panel.',
      ),
  },
  handler: async (request, response, context) => {
    if (request.params.reqid) {
      response.attachNetworkRequest(request.params.reqid);
    } else {
      const data = await context.getDevToolsData();
      response.attachDevToolsData(data);
      const reqid = data?.cdpRequestId
        ? context.resolveCdpRequestId(data.cdpRequestId)
        : undefined;
      if (reqid) {
        response.attachNetworkRequest(reqid);
      } else {
        response.appendResponseLine(
          `Nothing is currently selected in the DevTools Network panel.`,
        );
      }
    }
  },
});

export const getNetworkDetail = defineTool({
  name: 'get_network_detail',
  description: `Get detailed information for a specific network request. Works with list_network_requests to retrieve detailed data for a specific request. Supports selective data retrieval to avoid context pollution.`,
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    reqid: zod
      .number()
      .describe(
        'The reqid of the network request from list_network_requests.',
      ),
    dataType: zod
      .enum(['all', 'request', 'response'])
      .default('all')
      .optional()
      .describe(
        'Specify which data to return: "all" (both request and response), "request" (only request data), "response" (only response data). Default is "all".',
      ),
  },
  handler: async (request, response, context) => {
    const {reqid, dataType = 'all'} = request.params;

    // Attach the network request so McpResponse can format it and tests can assert on it.
    response.attachNetworkRequest(reqid);

    // 获取网络请求对象
    let httpRequest;
    try {
      httpRequest = context.getNetworkRequestById(reqid);
    } catch (error) {
      response.appendResponseLine(
        `Network request with reqid=${reqid} not found: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const httpResponse = httpRequest.response();

    if (dataType === 'all') {
      response.appendResponseLine(
        'Fetching both request and response data for this network request.',
      );
    } else if (dataType === 'request') {
      response.appendResponseLine(
        'Fetching request data only for this network request.',
      );
    } else {
      response.appendResponseLine(
        'Fetching response data only for this network request.',
      );
    }
    
    // 根据 dataType 构建响应内容
    response.appendResponseLine(`## Request ${httpRequest.url()}`);
    response.appendResponseLine(`Status: ${getStatusFromRequest(httpRequest)}`);

    // 包含请求数据
    if (dataType === 'all' || dataType === 'request') {
      response.appendResponseLine('### Request Headers');
      for (const line of getFormattedHeaderValue(httpRequest.headers())) {
        response.appendResponseLine(line);
      }

      const requestBody = await getFormattedRequestBody(httpRequest);
      if (requestBody) {
        response.appendResponseLine('### Request Body');
        response.appendResponseLine(requestBody);
      }
    }

    // 包含响应数据
    if (dataType === 'all' || dataType === 'response') {
      if (httpResponse) {
        response.appendResponseLine('### Response Headers');
        for (const line of getFormattedHeaderValue(httpResponse.headers())) {
          response.appendResponseLine(line);
        }

        const responseBody = await getFormattedResponseBody(httpResponse);
        if (responseBody) {
          response.appendResponseLine('### Response Body');
          response.appendResponseLine(responseBody);
        }
      } else {
        response.appendResponseLine('### Response');
        response.appendResponseLine('No response available.');
      }
    }

    // 如果有失败信息
    const httpFailure = httpRequest.failure();
    if (httpFailure && (dataType === 'all' || dataType === 'response')) {
      response.appendResponseLine('### Request failed with');
      response.appendResponseLine(httpFailure.errorText);
    }

    // 重定向链
    const redirectChain = httpRequest.redirectChain();
    if (redirectChain.length && (dataType === 'all' || dataType === 'request')) {
      response.appendResponseLine('### Redirect chain');
      let indent = 0;
      for (const req of redirectChain.reverse()) {
        response.appendResponseLine(
          `${'  '.repeat(indent)}${req.method()} ${req.url()} ${getStatusFromRequest(req)}`,
        );
        indent++;
      }
    }
  },
});
