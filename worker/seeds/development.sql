INSERT INTO categories (name, slug, sort) VALUES
  ('动作冒险', 'action-adventure', 10),
  ('角色扮演', 'role-playing', 20),
  ('模拟经营', 'simulation', 30),
  ('策略战棋', 'strategy', 40),
  ('独立游戏', 'indie', 50);

INSERT INTO tags (name, slug) VALUES
  ('开放世界', 'open-world'),
  ('剧情', 'story'),
  ('多人合作', 'co-op'),
  ('生存', 'survival'),
  ('像素', 'pixel'),
  ('休闲', 'casual');

INSERT INTO games (name, slug, cover_url, description, min_config, category_id, resource_type, status, publish_at) VALUES
  ('星海漂流者', 'stellar-drifter', '/assets/hero/hero-1.webp', '驾驶改装飞船穿越失落星域，在遗迹、风暴和未知信号之间寻找归途。', '["操作系统：Windows 10 64 位","处理器：Intel Core i5-8400","内存：8 GB RAM","显卡：GTX 1060 6 GB","存储空间：需要 45 GB 可用空间"]', 1, 'member', 'published', '2026-08-30'),
  ('霓虹极速', 'neon-racer', '/assets/hero/hero-2.webp', '在不断变化的海滨赛道上竞速，支持单人挑战与好友合作。', '["操作系统：Windows 10 64 位","处理器：Intel Core i3-8100","内存：8 GB RAM","显卡：GTX 1050 Ti","存储空间：需要 12 GB 可用空间"]', 5, 'free', 'published', '2026-08-28'),
  ('浮岛工坊', 'island-craft', '/assets/hero/hero-3.webp', '在漂浮群岛上收集材料、扩建工坊，并建立属于自己的空中聚落。', '["操作系统：Windows 10","处理器：Intel Core i3-6100","内存：4 GB RAM","显卡：GTX 750 Ti","存储空间：需要 6 GB 可用空间"]', 3, 'free', 'published', '2026-08-24'),
  ('深蓝战线', 'deep-tactics', '/assets/hero/hero-4.webp', '指挥深海调查队完成回合制任务，在有限补给与复杂地形中制定行动方案。', '["操作系统：Windows 10","处理器：Intel Core i5-6500","内存：8 GB RAM","显卡：GTX 960","存储空间：需要 10 GB 可用空间"]', 4, 'member', 'published', '2026-08-20');

INSERT INTO game_tags (game_id, tag_id) VALUES
  (1, 1), (1, 2), (2, 3), (2, 6), (3, 4), (3, 6), (4, 2), (4, 5);

-- 开发种子不写入真实网盘地址；由管理后台或本地测试迁移另行添加。
