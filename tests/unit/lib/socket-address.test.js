const { createRequire } = require('node:module')
const { test } = require('sounding')
const express = require('express')
const hookRequire = createRequire(require.resolve('sails-hook-sockets'))
const receiveMessage = hookRequire('./lib/receive-incoming-sails-io-msg')
const proxyaddr = hookRequire('proxy-addr')

test('socket requests preserve Express client-address trust and forwarding order', ({
  expect
}) => {
  const httpApp = express()
  let request
  const app = {
    config: { host: 'localhost' },
    hooks: { http: { app: httpApp } },
    log: { verbose() {} },
    router: {
      route(context) {
        request = context
      }
    }
  }
  const receive = receiveMessage(app)

  for (const [trust, address, forwarded, ip, ips] of [
    [false, '192.0.2.10', '198.51.100.2', '192.0.2.10', []],
    [
      true,
      '192.0.2.10',
      '198.51.100.2, 203.0.113.4',
      '198.51.100.2',
      ['198.51.100.2', '203.0.113.4']
    ],
    [
      1,
      '192.0.2.10',
      '198.51.100.2, 203.0.113.4',
      '203.0.113.4',
      ['203.0.113.4']
    ],
    [
      'loopback',
      '::ffff:127.0.0.1',
      '198.51.100.2',
      '198.51.100.2',
      ['198.51.100.2']
    ],
    [
      '10.0.0.0/8',
      '::ffff:10.0.0.1',
      '198.51.100.2',
      '198.51.100.2',
      ['198.51.100.2']
    ],
    [
      (peer, hop) => peer === '192.0.2.10' && hop === 0,
      '192.0.2.10',
      '198.51.100.2',
      '198.51.100.2',
      ['198.51.100.2']
    ]
  ]) {
    httpApp.set('trust proxy', trust)
    receive({
      incomingSailsIOMsg: { url: '/health' },
      eventName: 'get',
      socket: {
        handshake: {
          address,
          headers: { 'x-forwarded-for': forwarded },
          query: { __sails_io_sdk_version: '1.2.1' }
        }
      }
    })
    expect(request.ip).toBe(ip)
    expect(request.ips).toEqual(ips)
  }
})

test('socket address dependency rejects malformed mapped IPv6 trust subnets', ({
  expect
}) => {
  const invalidTrust = proxyaddr.compile('::ffff:10.0.0.0/8')
  expect(invalidTrust('192.0.2.1')).toBe(false)
  expect(invalidTrust('10.0.0.1')).toBe(false)
  const validTrust = proxyaddr.compile('::ffff:10.0.0.0/104')
  expect(validTrust('10.0.0.1')).toBe(true)
  expect(validTrust('192.0.2.1')).toBe(false)
})
