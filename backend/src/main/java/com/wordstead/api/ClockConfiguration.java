package com.wordstead.api;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ClockConfiguration {
    @Bean
    Clock utcClock() {
        return Clock.systemUTC();
    }
}
