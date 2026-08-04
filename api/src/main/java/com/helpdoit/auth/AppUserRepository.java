package com.helpdoit.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AppUserRepository extends JpaRepository<AppUser, UUID> {
    Optional<AppUser> findByEmail(String email);
    List<AppUser> findAllByOrderByEmailAsc();

    /** Case-insensitive substring match on email or name — backs the admin user picker. */
    @Query("""
        select u from AppUser u
        where lower(u.email) like lower(concat('%', :q, '%'))
           or lower(coalesce(u.name, '')) like lower(concat('%', :q, '%'))
        order by u.email asc
        """)
    List<AppUser> search(@Param("q") String q);
}
