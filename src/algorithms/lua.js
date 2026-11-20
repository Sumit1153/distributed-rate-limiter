// Redis TIME keeps distributed gateways on the same clock. Each script returns
// [allowed (1/0), remaining, retry_ms, reset_ms] and runs atomically.
const time = `local t = redis.call('TIME')\nlocal now = tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000)\nlocal cap = tonumber(ARGV[1])\nlocal window = tonumber(ARGV[2])\nlocal rate = cap/window\n`;

export const LUA = Object.freeze({
  token_bucket: time + `
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or cap
local last = tonumber(state[2]) or now
tokens = math.min(cap, tokens + math.max(0, now-last)*rate)
local ok = 0
if tokens >= 0.999999999 then ok=1; tokens=tokens-1 end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(window*2))
local retry=0
if ok==0 then retry=math.ceil((1-tokens)/rate) end
return {ok, math.floor(math.max(0,tokens)), retry, math.ceil((cap-tokens)/rate)}
`,
  fixed_window: time + `
local slot = math.floor(now/window)
local state = redis.call('HMGET', KEYS[1], 'slot', 'count')
local count = tonumber(state[2]) or 0
if tonumber(state[1]) ~= slot then count = 0 end
local ok = 0
if count < cap then ok=1; count=count+1 end
redis.call('HSET', KEYS[1], 'slot', slot, 'count', count)
redis.call('PEXPIRE', KEYS[1], window*2)
local reset = math.max(1,(slot+1)*window-now)
return {ok, math.max(0,cap-count), ok==1 and 0 or reset, reset}
`,
  sliding_window: time + `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now-window)
local count = redis.call('ZCARD', KEYS[1])
local ok = 0
if count < cap then
  ok=1
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  count=count+1
end
redis.call('PEXPIRE', KEYS[1], window*2)
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local reset=0
if #oldest > 0 then reset=math.max(0,math.ceil(tonumber(oldest[2])+window-now)) end
return {ok, math.max(0,cap-count), ok==1 and 0 or reset, reset}
`,
  // A leaky-bucket meter: rejects when full; it does not queue/delay requests.
  leaky_bucket: time + `
local state=redis.call('HMGET', KEYS[1], 'water', 'ts')
local water=tonumber(state[1]) or 0
local last=tonumber(state[2]) or now
water=math.max(0,water-math.max(0,now-last)*rate)
local ok=0
if water+1 <= cap+0.000000001 then ok=1; water=water+1 end
redis.call('HSET', KEYS[1], 'water', water, 'ts', now)
redis.call('PEXPIRE', KEYS[1], window*2)
local retry=0
if ok==0 then retry=math.ceil((water+1-cap)/rate) end
return {ok, math.floor(math.max(0,cap-water)), retry, math.ceil(water/rate)}
`
});
