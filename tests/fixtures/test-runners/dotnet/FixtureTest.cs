using Xunit;

public class FixtureTest
{
    [Fact]
    public void PassingExample() => Assert.Equal(4, 2 + 2);

    [Fact]
    public void FailingExample() => Assert.Equal(5, 2 + 2);
}
