import {CircleAlert, Info, ShieldAlert} from 'lucide-react';

const COMMON_ALLERGENS = ['Nuts', 'Gluten', 'Eggs', 'Spices', 'Dairy', 'Soy', 'Fish & shellfish'];

export default function MenuGuidance({compact = false, allergens = []}: {compact?: boolean; allergens?: string[]}) {
  if (compact) {
    return (
      <aside className="menu-safety-compact" aria-label="Allergy information">
        <ShieldAlert size={18} strokeWidth={1.8} aria-hidden />
        <div>
          <strong>{allergens.length > 0 ? `Contains: ${allergens.join(', ')}` : 'Allergy or dietary requirement?'}</strong>
          <p>Our kitchen uses shared equipment. Please tell your waiter before ordering so the team can assist you.</p>
        </div>
      </aside>
    );
  }

  return (
    <section className="card menu-guidance" aria-labelledby="menu-guidance-title">
      <div className="menu-guidance-intro">
        <span className="menu-guidance-icon"><CircleAlert size={21} strokeWidth={1.8} aria-hidden /></span>
        <div>
          <p className="sectionlabel">Before you order</p>
          <h2 id="menu-guidance-title">Allergies and dietary needs</h2>
          <p>
            Dishes may contain or come into contact with common allergens. Because our kitchen and cooking equipment are
            shared, we cannot guarantee that any dish is completely allergen-free.
          </p>
        </div>
      </div>

      <div className="allergen-pills" aria-label="Common allergens used in the kitchen">
        {COMMON_ALLERGENS.map((allergen) => <span key={allergen}>{allergen}</span>)}
      </div>

      <div className="menu-guidance-action">
        <ShieldAlert size={18} strokeWidth={1.8} aria-hidden />
        <p><strong>Please tell your waiter before ordering</strong> if anyone at your table has an allergy or dietary restriction.</p>
      </div>

      <div className="menu-guidance-meta">
        <Info size={16} strokeWidth={1.8} aria-hidden />
        <p>Prices are in Botswana pula (BWP). Menu photography is representative, and availability may change.</p>
      </div>
    </section>
  );
}
