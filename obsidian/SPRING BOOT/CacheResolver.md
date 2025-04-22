`CacheResolver`를 사용하면 런타임에 어떤 캐시를 사용할지 동적으로 결정할 수 있어.
```java
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.interceptor.CacheOperationInvocationContext;
import org.springframework.cache.interceptor.SimpleCacheResolver;

import java.util.Collection;
import java.util.[[Collections]];

public class CustomCacheResolver extends SimpleCacheResolver {

    public CustomCacheResolver(CacheManager cacheManager) {
        super(cacheManager);
    }

    @Override
    protected Collection<String> getCacheNames(CacheOperationInvocationContext<?> context) {
        // context.getTarget(), context.getMethod(), context.getArgs() 등을 이용하여
        // 어떤 캐시를 사용할지 결정하는 로직을 구현합니다.

        // 예시: 메서드 이름에 따라 다른 캐시 사용
        if (context.getMethod().getName().startsWith("get")) {
            return [[Collections]].singletonList("readCache"); //읽기 전용.
        } else {
            return [[Collections]].singletonList("writeCache"); //쓰기, 업데이트, 삭제.
        }
    }
     @Override
      protected Collection<? extends Cache> resolveCaches(CacheOperationInvocationContext<?> context) {
          Collection<String> cacheNames = this.getCacheNames(context);
          if (cacheNames == null) {
              return [[Collections]].emptyList();
          } else {
              Collection<Cache> result = new ArrayList<>(cacheNames.size());
              for (String cacheName : cacheNames) {
                  Cache cache = this.getCacheManager().getCache(cacheName);
                  if (cache == null) {
                      throw new IllegalArgumentException("Cannot find cache named '" + cacheName + "' for " + context.getOperation());
                  }
                  result.add(cache);
              }
              return result;
          }
      }
}
```