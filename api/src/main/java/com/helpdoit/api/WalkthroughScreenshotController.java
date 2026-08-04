package com.helpdoit.api;

import com.helpdoit.walkthrough.WalkthroughService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * HTTP upload for a recording step's screenshot. Screenshots are far too large
 * for an RSocket-over-WebSocket frame (which truncates ~64 KB), so the extension
 * streams the small step over RSocket and POSTs the image here separately.
 */
@RestController
@RequestMapping("/api/walkthroughs")
class WalkthroughScreenshotController {

    private final WalkthroughService service;

    WalkthroughScreenshotController(WalkthroughService service) {
        this.service = service;
    }

    @PostMapping("/{walkthroughId}/screenshots")
    void upload(@PathVariable String walkthroughId, @RequestBody ScreenshotUpload body) {
        service.saveScreenshot(UUID.fromString(walkthroughId), body.stepIndex(), body.image(), body.contentType());
    }

    /** image: base64 (data-URL body); stepIndex: which step it belongs to. */
    record ScreenshotUpload(int stepIndex, String image, String contentType) {}
}
