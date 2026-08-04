package com.helpdoit.api;

import com.helpdoit.tag.TagService;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.util.List;

/**
 * RSocket "tags" route — type-ahead suggestions for the Train-mode tags box
 * (existing tag names matching the query). New tags are created on save.
 */
@Controller
class TagRsocketController {

    private final TagService tagService;

    TagRsocketController(TagService tagService) {
        this.tagService = tagService;
    }

    @MessageMapping("tags")
    List<String> tags(SuggestRequest request) {
        return tagService.suggest(request.query());
    }

    record SuggestRequest(String query) {}
}
