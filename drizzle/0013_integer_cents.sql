CREATE TRIGGER courses_price_insert
BEFORE INSERT ON courses
WHEN NEW.price IS NOT NULL AND typeof(NEW.price) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'courses.price must be integer cents');
END;
--> statement-breakpoint
CREATE TRIGGER courses_price_update
BEFORE UPDATE OF price ON courses
WHEN NEW.price IS NOT NULL AND typeof(NEW.price) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'courses.price must be integer cents');
END;
--> statement-breakpoint
CREATE TRIGGER purchases_amount_paid_insert
BEFORE INSERT ON purchases
WHEN NEW.amount_paid IS NOT NULL AND typeof(NEW.amount_paid) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'purchases.amount_paid must be integer cents');
END;
--> statement-breakpoint
CREATE TRIGGER purchases_amount_paid_update
BEFORE UPDATE OF amount_paid ON purchases
WHEN NEW.amount_paid IS NOT NULL AND typeof(NEW.amount_paid) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'purchases.amount_paid must be integer cents');
END;
--> statement-breakpoint
CREATE TRIGGER refunds_amount_refunded_insert
BEFORE INSERT ON refunds
WHEN NEW.amount_refunded IS NOT NULL AND typeof(NEW.amount_refunded) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'refunds.amount_refunded must be integer cents');
END;
--> statement-breakpoint
CREATE TRIGGER refunds_amount_refunded_update
BEFORE UPDATE OF amount_refunded ON refunds
WHEN NEW.amount_refunded IS NOT NULL AND typeof(NEW.amount_refunded) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'refunds.amount_refunded must be integer cents');
END;
