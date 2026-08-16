class PlayerStats {
  final int duelsPlayed;
  final int duelsWon;
  final int duelsLost;
  final int duelsDrawn;
  final int totalPoints;
  final int playedQuestionsCount;

  const PlayerStats({
    this.duelsPlayed = 0,
    this.duelsWon = 0,
    this.duelsLost = 0,
    this.duelsDrawn = 0,
    this.totalPoints = 0,
    this.playedQuestionsCount = 0,
  });

  double get winRate => duelsPlayed > 0 ? (duelsWon / duelsPlayed) * 100 : 0.0;
}
