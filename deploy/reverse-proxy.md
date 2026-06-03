# Reverse Proxy

## Caddy

```caddyfile
helmr.example.com {
  reverse_proxy 127.0.0.1:3999
  header_up Authorization {>Authorization}
}
```

## Nginx

Terminate TLS, forward `Authorization`, and restrict origins to your Hatchery/WebChat URL. Never use wildcard CORS in production.
