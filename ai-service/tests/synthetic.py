"""Synthetic test images for the AI-in-Checklist checks (shelf/poster scene, staff photos)."""

from __future__ import annotations

import cv2, numpy as np


def scene(seed=1, w=1200, h=800, poster=True):
    rs = np.random.RandomState(seed)
    img = np.full((h, w, 3), (205, 215, 225), np.uint8)
    img = (img.astype(np.int16) + rs.randint(-6, 6, (h, w, 1))).clip(0,255).astype(np.uint8)
    for y in (300, 520, 740):  # shelves with products
        cv2.rectangle(img, (40, y), (w - 40, y + 14), (70, 90, 120), -1)
        x = 50
        while x < w - 120:
            bw, bh = rs.randint(40, 90), rs.randint(60, 150)
            col = tuple(int(c) for c in rs.randint(30, 230, 3))
            cv2.rectangle(img, (x, y - bh), (x + bw, y), col, -1)
            cv2.rectangle(img, (x, y - bh), (x + bw, y), (20, 20, 20), 2)
            cv2.putText(img, "ABC"[rs.randint(3)], (x + 8, y - bh // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            x += bw + rs.randint(5, 20)
    if poster:
        cv2.rectangle(img, (820, 30), (1150, 250), (30, 30, 200), -1)
        cv2.putText(img, "MEGA SALE", (845, 110), cv2.FONT_HERSHEY_DUPLEX, 1.4, (255, 255, 255), 3)
        cv2.putText(img, "50% OFF", (880, 190), cv2.FONT_HERSHEY_DUPLEX, 1.5, (0, 230, 255), 3)
        cv2.circle(img, (1100, 220), 20, (255, 255, 255), 3)
    cv2.putText(img, "CONGRUENCE", (60, 120), cv2.FONT_HERSHEY_TRIPLEX, 2.0, (40, 60, 90), 4)
    return img


def remove_poster(img):
    out = img.copy()
    rs = np.random.RandomState(9)
    patch = np.full((221, 331, 3), (205, 215, 225), np.uint8)
    patch = (patch.astype(np.int16) + rs.randint(-6, 6, (221, 331, 1))).clip(0,255).astype(np.uint8)
    out[30:251, 820:1151] = patch
    return out


def perspective(img, k=0.04, scale=0.92):
    h, w = img.shape[:2]
    src = np.float32([[0,0],[w,0],[w,h],[0,h]])
    dst = np.float32([[w*k, h*k],[w*(1-k*0.5), h*k*0.3],[w*(1-k), h*(1-k)],[w*k*0.4, h*(1-k*0.6)]])
    M = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(img, M, (w, h), borderValue=(120,120,120))
    return out



def staff_photo(shirt=(150, 140, 20), card=True, lanyard=True, w=600, h=900, seed=0):
    rs = np.random.RandomState(seed)
    img = np.full((h, w, 3), (190, 200, 205), np.uint8)
    img = (img.astype(np.int16) + rs.randint(-5, 5, (h, w, 1))).clip(0, 255).astype(np.uint8)
    cv2.ellipse(img, (w//2, int(h*0.12)), (70, 90), 0, 0, 360, (120, 160, 210), -1)          # head
    cv2.rectangle(img, (int(w*0.18), int(h*0.22)), (int(w*0.82), int(h*0.62)), shirt, -1)  # torso
    cv2.rectangle(img, (int(w*0.05), int(h*0.24)), (int(w*0.18), int(h*0.55)), shirt, -1)  # arms
    cv2.rectangle(img, (int(w*0.82), int(h*0.24)), (int(w*0.95), int(h*0.55)), shirt, -1)
    cv2.rectangle(img, (int(w*0.25), int(h*0.62)), (int(w*0.75), h), (50, 45, 40), -1)      # trousers
    if lanyard:
        cv2.line(img, (int(w*0.42), int(h*0.22)), (int(w*0.47), int(h*0.40)), (30, 30, 160), 6)
        cv2.line(img, (int(w*0.58), int(h*0.22)), (int(w*0.53), int(h*0.40)), (30, 30, 160), 6)
    if card:
        x1, y1, x2, y2 = int(w*0.42), int(h*0.40), int(w*0.58), int(h*0.50)
        cv2.rectangle(img, (x1, y1), (x2, y2), (245, 245, 245), -1)
        cv2.rectangle(img, (x1+8, y1+10), (x1+35, y1+45), (90, 90, 90), -1)
        cv2.line(img, (x1+42, y1+20), (x2-8, y1+20), (40, 40, 40), 3)
        cv2.line(img, (x1+42, y1+40), (x2-8, y1+40), (40, 40, 40), 3)
    return img
