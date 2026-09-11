import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryString, buildUrl, isNetworkError } from './url.js';

describe('buildQueryString', () => {
  it('returns empty string when there are no params', () => {
    assert.equal(buildQueryString(), '');
    assert.equal(buildQueryString({}), '');
  });

  it('serializes primitive values', () => {
    assert.equal(buildQueryString({ a: 1, b: 'x', c: true }), '?a=1&b=x&c=true');
  });

  it('skips undefined and null values', () => {
    assert.equal(buildQueryString({ a: 1, b: undefined, c: null }), '?a=1');
  });

  it('encodes array values as repeated keys', () => {
    assert.equal(buildQueryString({ tags: [1, 2, 'x'] }), '?tags=1&tags=2&tags=x');
  });

  it('URL-encodes special characters', () => {
    assert.equal(buildQueryString({ q: 'a b&c' }), '?q=a+b%26c');
  });
});

describe('buildUrl', () => {
  it('strips trailing slashes from baseUrl', () => {
    assert.equal(buildUrl('https://api.example.com/', '/users'), 'https://api.example.com/users');
  });

  it('prepends slash when path has no leading slash', () => {
    assert.equal(buildUrl('https://api.example.com', 'users'), 'https://api.example.com/users');
  });

  it('uses path as-is when baseUrl is omitted', () => {
    assert.equal(buildUrl(undefined, '/users'), '/users');
  });

  it('appends query params at the end', () => {
    assert.equal(
      buildUrl('https://api.example.com', '/users', { active: true }),
      'https://api.example.com/users?active=true'
    );
  });

  it('ignores baseUrl when path is already an absolute http(s) URL', () => {
    assert.equal(
      buildUrl('https://api.example.com', 'https://other-service.com/data'),
      'https://other-service.com/data'
    );
  });

  it('ignores baseUrl for absolute URLs and still appends query params', () => {
    assert.equal(
      buildUrl('https://api.example.com', 'http://other-service.com/data', { id: 1 }),
      'http://other-service.com/data?id=1'
    );
  });
});

describe('isNetworkError', () => {
  it('returns false for AbortError', () => {
    const err = new DOMException('aborted', 'AbortError');
    assert.equal(isNetworkError(err), false);
  });

  it('returns true for TypeError (fetch/undici connection failures)', () => {
    assert.equal(isNetworkError(new TypeError('fetch failed')), true);
  });

  it('returns true for known Node/undici network error codes', () => {
    const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    assert.equal(isNetworkError(err), true);
  });

  it('returns false for unrelated/programming errors', () => {
    assert.equal(isNetworkError(new RangeError('boom')), false);
    assert.equal(isNetworkError('random string'), false);
    assert.equal(isNetworkError(new Error('generic error')), false);
  });
});
