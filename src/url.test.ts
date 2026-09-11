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
});

describe('isNetworkError', () => {
  it('returns false for AbortError', () => {
    const err = new DOMException('aborted', 'AbortError');
    assert.equal(isNetworkError(err), false);
  });

  it('returns true for other errors', () => {
    assert.equal(isNetworkError(new TypeError('network fail')), true);
    assert.equal(isNetworkError('random string'), true);
  });
});
