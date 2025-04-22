`RedisTemplate`은 Redis 명령을 직접 실행하기 위한 저수준 API를 제공합니다. 다양한 Redis 데이터 구조(String, List, Set, Hash, Sorted Set 등)를 다루기 위한 편리한 메서드를 제공하며, 직렬화/역직렬화를 자동으로 처리해.
- 저수준 API, Redis 명령을 직접 실행.
- 유연성이 높지만, 코드가 더 장황해질 수 있음.
- 직렬화/역직렬화 직접 처리 (또는 설정).
- 트랜잭션, 파이프라인 등 고급 기능 지원.

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;


@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);

        // Key Serializer
        template.setKeySerializer(new StringRedisSerializer());

        // Value Serializer (JSON 형식)
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer());

        // Hash Key, Value Serializer
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer());


        template.afterPropertiesSet(); // 필수 설정
        return template;
    }
}
```

