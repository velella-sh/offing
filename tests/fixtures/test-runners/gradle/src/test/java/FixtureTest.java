import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class FixtureTest {
    @Test public void passingExample() { assertEquals(4, 2 + 2); }
    @Test public void failingExample() { assertEquals(5, 2 + 2); }
}
