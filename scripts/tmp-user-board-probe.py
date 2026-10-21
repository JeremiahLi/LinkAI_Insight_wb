import sqlite3

c = sqlite3.connect("prisma/dev.db")
q = lambda s: c.execute(s).fetchall()

print("--- totalRounds 分布 ---")
print(q("select totalRounds, count(*) from Session group by totalRounds order by totalRounds limit 15"))

print("--- 近7天会话 ---")
for r in q(
    "select date(startTime/1000,'unixepoch','localtime') d, totalRounds, totalSpans, totalTokens "
    "from Session where startTime >= 1759939200000 order by startTime desc limit 20"
):
    print(r)
