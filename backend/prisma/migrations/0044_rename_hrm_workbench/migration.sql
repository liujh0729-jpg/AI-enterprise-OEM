-- 「人力工作台」更名为「HR工作台」：ensureSeed 只补缺失项、不覆盖存量标题，已有库需显式回填。
UPDATE feature_catalog SET title = 'HR工作台' WHERE code = 'hrm' AND title = '人力工作台';
