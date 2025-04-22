
`CachingConfigurer` 인터페이스를 구현하여 Redis를 캐시 관리자로 설정해.

```java
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.cache.interceptor.CacheResolver;
import org.springframework.cache.interceptor.KeyGenerator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;


@Configuration
@EnableCaching // 캐싱 활성화
public class RedisCacheConfig implements CachingConfigurer {

    private final RedisConnectionFactory connectionFactory; // RedisConnectionFactory 주입

    public RedisCacheConfig(RedisConnectionFactory connectionFactory) {
        this.connectionFactory = connectionFactory;
    }


    @Bean
    @Override
    public CacheManager cacheManager() {
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
            .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer())) // Key Serializer
            .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer())) // Value Serializer
            .entryTtl(Duration.ofMinutes(30)); // Default TTL (30분)


        // 캐시별 설정 (필요한 경우)
        Map<String, RedisCacheConfiguration> cacheConfigurations = new HashMap<>();
        cacheConfigurations.put("userCache", defaultConfig.entryTtl(Duration.ofHours(1))); // userCache는 1시간 TTL
        cacheConfigurations.put("productCache", defaultConfig.entryTtl(Duration.ofDays(1))); // productCache는 하루 TTL

        return RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(defaultConfig)
                .withInitialCacheConfigurations(cacheConfigurations)
                .build();

    }

    @Override
    public CacheResolver cacheResolver() {
        // 필요하다면 Custom CacheResolver 구현
        return null; // 기본 CacheResolver 사용 (cacheManager()에서 설정한 CacheManager)
    }

    @Override
    public KeyGenerator keyGenerator() {
        // 필요하다면 Custom KeyGenerator 구현
        return null; // 기본 KeyGenerator 사용 (SimpleKeyGenerator)
    }

    @Override
    public CacheErrorHandler errorHandler() {
        // 필요하다면 Custom CacheErrorHandler 구현.
        return null;  //기본 에러 핸들러.
    }
}
```